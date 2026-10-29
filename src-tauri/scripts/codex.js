// Codex: the usage endpoint needs the session's Bearer token, which only the page fetches.
const readUsage = async () => {
  const session = await fetchJson('/api/auth/session');
  if (!session.ok) {
    return { status: 'http_error', step: 'session', http_status: session.status };
  }

  const accessToken = session.data && session.data.accessToken;
  if (typeof accessToken !== 'string' || accessToken === '') {
    return { status: 'http_error', step: 'session', http_status: 401 };
  }

  const headers = { Authorization: 'Bearer ' + accessToken };
  const accountId = session.data.account && session.data.account.id;
  if (typeof accountId === 'string' && accountId !== '') {
    headers['ChatGPT-Account-Id'] = accountId;
  }

  const usage = await fetchJson('/backend-api/wham/usage', headers);
  if (!usage.ok) {
    return { status: 'http_error', step: 'usage', http_status: usage.status };
  }

  const limits = usage.data.rate_limit;
  if (!limits) {
    return { status: 'unexpected_response' };
  }

  const windows = [limits.primary_window, limits.secondary_window].filter(Boolean);
  const pick = (seconds) => {
    const value = windows.find((item) => item.limit_window_seconds === seconds);
    if (!value) {
      return null;
    }

    return {
      utilization: value.used_percent,
      resets_at:
        typeof value.reset_at === 'number' ? new Date(value.reset_at * 1000).toISOString() : null,
    };
  };

  const fiveHour = pick(18000);
  const sevenDay = pick(604800);
  // Neither known window means the format changed; better an error than a false 0%.
  if (!fiveHour && !sevenDay) {
    return { status: 'unexpected_response' };
  }

  // Purchased credits beyond the plan; only the remaining balance is reported.
  const credits = usage.data.credits;

  return {
    status: 'ok',
    plan: usage.data.plan_type,
    five_hour: fiveHour,
    seven_day: sevenDay,
    extra: credits
      ? { kind: 'credits', unlimited: credits.unlimited, balance: credits.balance }
      : null,
  };
};
