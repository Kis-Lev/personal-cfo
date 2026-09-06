// Single id-generation helper — every "create a new X" path uses this instead
// of inlining its own `${prefix}_${crypto.randomUUID()}` pattern.
export function createId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}
