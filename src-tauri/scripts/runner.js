// Appended after a provider script that defines `readUsage`.
// Starts one reading and leaves its JSON result on `window` for poll.js.
// Credentials stay inside the page; only the normalized result leaves it.

async function fetchJson(path, headers = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  return { ok: true, data: await response.json() };
}

const key = '__aiUsageReader';
const abandonedAfterMs = 60000;
const previous = window[key];
if (previous && Date.now() - previous.startedAt < abandonedAfterMs) {
  return 'BUSY';
}

const state = { done: false, result: '', startedAt: Date.now() };
window[key] = state;

readUsage()
  .then((result) => {
    state.result = JSON.stringify(result);
  })
  .catch((error) => {
    state.result = JSON.stringify({
      status: error instanceof SyntaxError ? 'unexpected_response' : 'network_error',
    });
  })
  .finally(() => {
    state.done = true;
  });

return 'STARTED';
