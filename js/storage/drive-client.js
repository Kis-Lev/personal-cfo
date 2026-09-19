// Thin wrapper around the Google Drive REST API v3, called directly via fetch()
// (no gapi client library) so the only third-party code in the whole app is the
// official Google Identity Services script used for login (see auth/google-auth.js).
import { DRIVE_API_BASE, DRIVE_UPLOAD_API_BASE, DRIVE_FOLDER_NAME, DRIVE_IMPORTS_FOLDER_NAME, DB_FILE_NAME, CONFIG_FILE_NAME } from "../config/constants.js";

const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";

// Every save was doing a "search by filename" call before every write, even
// though the file's id never changes once found — that meant 2 Drive API
// round-trips per save instead of 1. Cache the id for this session so repeat
// saves (which happen on almost every user action) skip the redundant search.
// Keyed by folder AS WELL AS name: the same name exists in two folders the
// moment a statement file happens to be called db.json, and a name-only key
// would hand back the root database's id and overwrite it with the upload.
const fileIdCache = new Map();

function fileIdCacheKey(folderId, fileName) {
  return JSON.stringify([folderId, fileName]);
}

function authHeaders(accessToken) {
  return { Authorization: `Bearer ${accessToken}` };
}

async function driveFetch(accessToken, path, options = {}) {
  // Financial data must never come from a stale browser HTTP cache — always
  // hit the network, even for a GET the browser might otherwise think it can
  // reuse.
  const response = await fetch(`${DRIVE_API_BASE}${path}`, {
    ...options,
    cache: "no-store",
    headers: { ...authHeaders(accessToken), ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`Drive API error ${response.status}: ${await response.text()}`);
  }
  return response;
}

// Drive's query language takes single-quoted string literals, so a value that
// contains a quote or backslash would otherwise terminate the literal early and
// let the rest of the value be read as query syntax. Reached with attacker-
// controlled input directly: an imported file is looked up by its own file name.
function escapeDriveQueryValue(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findChild(accessToken, name, parentId, mimeType) {
  const parentClause = parentId ? ` and '${escapeDriveQueryValue(parentId)}' in parents` : " and 'root' in parents";
  const mimeClause = mimeType ? ` and mimeType='${escapeDriveQueryValue(mimeType)}'` : "";
  const q = `name='${escapeDriveQueryValue(name)}' and trashed=false${parentClause}${mimeClause}`;
  const response = await driveFetch(accessToken, `/files?q=${encodeURIComponent(q)}&fields=files(id,name)`);
  const { files } = await response.json();
  return files[0] || null;
}

async function createFolder(accessToken, name, parentId) {
  const response = await driveFetch(accessToken, "/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: FOLDER_MIME_TYPE,
      parents: parentId ? [parentId] : undefined,
    }),
  });
  return response.json();
}

async function findOrCreateFolder(accessToken, name, parentId) {
  const existing = await findChild(accessToken, name, parentId, FOLDER_MIME_TYPE);
  if (existing) return existing;
  return createFolder(accessToken, name, parentId);
}

/** Ensures MyCFO_Data/ and MyCFO_Data/imports/ exist, returns both folder ids. */
export async function ensureAppFolders(accessToken) {
  const root = await findOrCreateFolder(accessToken, DRIVE_FOLDER_NAME, null);
  const imports = await findOrCreateFolder(accessToken, DRIVE_IMPORTS_FOLDER_NAME, root.id);
  return { rootFolderId: root.id, importsFolderId: imports.id };
}

async function resolveFileId(accessToken, folderId, fileName) {
  const cacheKey = fileIdCacheKey(folderId, fileName);
  if (fileIdCache.has(cacheKey)) return fileIdCache.get(cacheKey);
  const existing = await findChild(accessToken, fileName, folderId, null);
  if (existing) fileIdCache.set(cacheKey, existing.id);
  return existing?.id ?? null;
}

async function readJsonFile(accessToken, folderId, fileName) {
  const fileId = await resolveFileId(accessToken, folderId, fileName);
  if (!fileId) return null;
  const response = await driveFetch(accessToken, `/files/${fileId}?alt=media`);
  return response.json();
}

async function writeJsonFile(accessToken, folderId, fileName, data) {
  const fileId = await resolveFileId(accessToken, folderId, fileName);
  const body = JSON.stringify(data, null, 2);

  if (fileId) {
    await fetch(`${DRIVE_UPLOAD_API_BASE}/files/${fileId}?uploadType=media`, {
      method: "PATCH",
      headers: { ...authHeaders(accessToken), "Content-Type": "application/json" },
      body,
    });
    return fileId;
  }

  const boundary = "cfo_app_boundary";
  const metadata = { name: fileName, parents: [folderId] };
  const multipartBody =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;

  const response = await fetch(`${DRIVE_UPLOAD_API_BASE}/files?uploadType=multipart`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
  const newId = (await response.json()).id;
  fileIdCache.set(fileIdCacheKey(folderId, fileName), newId);
  return newId;
}

export function readDb(accessToken, rootFolderId) {
  return readJsonFile(accessToken, rootFolderId, DB_FILE_NAME);
}

export function writeDb(accessToken, rootFolderId, data) {
  return writeJsonFile(accessToken, rootFolderId, DB_FILE_NAME, data);
}

export function readConfig(accessToken, rootFolderId) {
  return readJsonFile(accessToken, rootFolderId, CONFIG_FILE_NAME);
}

export function writeConfig(accessToken, rootFolderId, data) {
  return writeJsonFile(accessToken, rootFolderId, CONFIG_FILE_NAME, data);
}

/**
 * Archives an uploaded source file (raw CSV/XLSX bytes) into MyCFO_Data/imports/.
 * Re-uploading a file with the same name (e.g. re-processing an old statement
 * after a parser fix) overwrites that same Drive file in place, rather than
 * piling up duplicate copies of it.
 */
export async function archiveImportFile(accessToken, importsFolderId, file) {
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  const contentType = file.type || "application/octet-stream";
  const existingFileId = await resolveFileId(accessToken, importsFolderId, file.name);

  if (existingFileId) {
    await fetch(`${DRIVE_UPLOAD_API_BASE}/files/${existingFileId}?uploadType=media`, {
      method: "PATCH",
      headers: { ...authHeaders(accessToken), "Content-Type": contentType },
      body: fileBytes,
    });
    return existingFileId;
  }

  const boundary = "cfo_app_boundary";
  const metadata = { name: file.name, parents: [importsFolderId] };
  const encoder = new TextEncoder();
  const head = encoder.encode(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`
  );
  const tail = encoder.encode(`\r\n--${boundary}--`);
  const body = new Blob([head, fileBytes, tail]);

  const response = await fetch(`${DRIVE_UPLOAD_API_BASE}/files?uploadType=multipart`, {
    method: "POST",
    headers: { ...authHeaders(accessToken), "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const newFileId = (await response.json()).id;
  fileIdCache.set(fileIdCacheKey(importsFolderId, file.name), newFileId);
  return newFileId;
}
