(() => {
  const state = window.__aiUsageReader;
  if (!state) {
    return JSON.stringify({ status: 'page_reloaded' });
  }
  if (!state.done) {
    return '';
  }

  delete window.__aiUsageReader;

  return state.result;
})()
