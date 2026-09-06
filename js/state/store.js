// Single, app-wide state container. Every screen reads and writes through this
// module instead of holding its own copy of data, so there is exactly one place
// that owns app state and exactly one place that notifies listeners of changes.

let state = null;
const listeners = new Set();

export function initStore(initialData) {
  state = initialData;
  notify();
}

export function getState() {
  return state;
}

export function setState(updater) {
  state = typeof updater === "function" ? updater(state) : { ...state, ...updater };
  notify();
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of listeners) {
    listener(state);
  }
}
