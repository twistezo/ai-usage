// Appended after a provider script that defines `readUsage`.
// Reports the normalized result through the document title, so the remote page
// never gets access to the app's IPC. Credentials stay inside the page.

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

// Must match TITLE_PREFIX in session_reader.rs.
// WebKit cuts titles at about 1000 characters, so keep reports small.
const prefix = '__AIUSAGE__';

readUsage()
  .catch((error) => ({
    status: error instanceof SyntaxError ? 'unexpected_response' : 'network_error',
  }))
  .then((result) => {
    const original = document.title.startsWith(prefix) ? '' : document.title;
    document.title = prefix + JSON.stringify(result);
    // Restoring the title lets an identical next report change it again.
    setTimeout(() => {
      document.title = original;
    }, 300);
  });
