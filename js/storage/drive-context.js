// Holds the (stable, non-persisted) Drive folder ids for this session, separate
// from the store's persisted schema fields — set once right after login.
let context = null;

export function setDriveContext(ctx) {
  context = ctx;
}

export function getDriveContext() {
  if (!context) throw new Error("Drive context not initialized — call setDriveContext() after login.");
  return context;
}
