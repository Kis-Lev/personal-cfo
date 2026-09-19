// Every data/*.json configuration file is fetched once and reused for the rest
// of the session. That fetch-and-cache lives here alone, instead of being
// re-implemented in each of the modules that loads one.
const cachedRequests = new Map();

/**
 * The in-flight promise is what gets cached, not just its result, so two
 * screens loading the same file at the same time share one request instead of
 * each firing its own before either has finished.
 * @param {URL|string} url
 * @returns {Promise<unknown>} the parsed JSON
 */
export function loadJsonOnce(url) {
  const key = String(url);
  if (!cachedRequests.has(key)) {
    const request = fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`לא ניתן לטעון ${key}: ${response.status}`);
        return response.json();
      })
      .catch((err) => {
        cachedRequests.delete(key); // a failed load must not be cached as the answer
        throw err;
      });
    cachedRequests.set(key, request);
  }
  return cachedRequests.get(key);
}
