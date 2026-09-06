// Self-contained XLSX reader. An .xlsx file is a ZIP archive of XML parts; this
// module implements just enough of the ZIP spec (central directory + local
// headers) to pull out the shared-string table and the first worksheet, using
// only native browser APIs: DecompressionStream (for the DEFLATE entries),
// DOMParser (for the XML) and TextDecoder. No third-party library involved.
// Produces the same shape tabular-parser.js expects from csv-parser.js: string[][].

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;

function findEndOfCentralDirectory(view) {
  for (let i = view.byteLength - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  throw new Error("קובץ אינו XLSX/ZIP תקין: לא נמצא End Of Central Directory.");
}

function readCentralDirectory(view, bytes) {
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map();
  let offset = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    if (view.getUint32(offset, true) !== CENTRAL_DIR_SIGNATURE) {
      throw new Error("ZIP central directory פגום.");
    }
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    entries.set(name, { compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function extractEntry(view, bytes, entry) {
  const { compressionMethod, compressedSize, localHeaderOffset } = entry;
  if (view.getUint32(localHeaderOffset, true) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error("ZIP local file header פגום.");
  }
  const nameLength = view.getUint16(localHeaderOffset + 26, true);
  const extraLength = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const compressedBytes = bytes.subarray(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) return compressedBytes;
  if (compressionMethod === 8) {
    const stream = new Blob([compressedBytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  throw new Error(`שיטת דחיסת ZIP לא נתמכת: ${compressionMethod}`);
}

async function readEntryAsText(view, bytes, entries, path) {
  const entry = entries.get(path);
  if (!entry) return null;
  const data = await extractEntry(view, bytes, entry);
  return new TextDecoder("utf-8").decode(data);
}

function parseSharedStrings(xmlText) {
  if (!xmlText) return [];
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  return Array.from(doc.getElementsByTagName("si")).map((si) =>
    Array.from(si.getElementsByTagName("t"))
      .map((t) => t.textContent)
      .join("")
  );
}

function columnLettersToIndex(cellRef) {
  const letters = cellRef.match(/[A-Z]+/)[0];
  let index = 0;
  for (const char of letters) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseWorksheet(xmlText, sharedStrings) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const rows = [];

  for (const rowEl of Array.from(doc.getElementsByTagName("row"))) {
    const row = [];
    for (const cellEl of Array.from(rowEl.getElementsByTagName("c"))) {
      const ref = cellEl.getAttribute("r");
      const type = cellEl.getAttribute("t");
      const valueEl = cellEl.getElementsByTagName("v")[0];
      let value = valueEl ? valueEl.textContent : "";
      if (type === "s") value = sharedStrings[Number(value)] ?? "";
      if (ref) row[columnLettersToIndex(ref)] = value;
    }
    rows.push(Array.from(row, (cell) => cell ?? ""));
  }

  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

/** @param {ArrayBuffer} arrayBuffer raw bytes of the uploaded .xlsx file */
export async function parseXlsx(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const entries = readCentralDirectory(view, bytes);

  const sharedStringsXml = await readEntryAsText(view, bytes, entries, "xl/sharedStrings.xml");
  const sharedStrings = parseSharedStrings(sharedStringsXml);

  const sheetXml = await readEntryAsText(view, bytes, entries, "xl/worksheets/sheet1.xml");
  if (!sheetXml) {
    throw new Error("לא נמצא גיליון בקובץ ה-XLSX (xl/worksheets/sheet1.xml חסר).");
  }
  return parseWorksheet(sheetXml, sharedStrings);
}
