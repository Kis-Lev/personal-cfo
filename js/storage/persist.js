// Single save function — every screen that mutates the store calls this instead
// of each re-implementing its own writeDb() call.
import { getAccessToken } from "../auth/google-auth.js";
import { getDriveContext } from "./drive-context.js";
import { writeDb } from "./drive-client.js";
import { getState } from "../state/store.js";

export async function persistState() {
  const { rootFolderId } = getDriveContext();
  await writeDb(getAccessToken(), rootFolderId, getState());
}
