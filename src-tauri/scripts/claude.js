// Claude: session cookies are enough.
const readUsage = async () => {
  const organizations = await fetchJson('/api/organizations');
  if (!organizations.ok) {
    return { status: 'http_error', step: 'organizations', http_status: organizations.status };
  }
  if (!Array.isArray(organizations.data) || organizations.data.length === 0) {
    return { status: 'unexpected_response' };
  }

  // API-only organizations have no subscription limits, so prefer one with chat.
  const organization =
    organizations.data.find(
      (item) => Array.isArray(item.capabilities) && item.capabilities.includes('chat'),
    ) ?? organizations.data[0];
  if (typeof organization.uuid !== 'string' || organization.uuid === '') {
    return { status: 'unexpected_response' };
  }

  const usage = await fetchJson(
    '/api/organizations/' + encodeURIComponent(organization.uuid) + '/usage',
  );
  if (!usage.ok) {
    return { status: 'http_error', step: 'usage', http_status: usage.status };
  }

  // A window is an object, or null while unused; a reading with neither window
  // means the format changed, which must not look like 0%.
  const data = usage.data;
  const isWindow = (value) =>
    value === null || value === undefined || (typeof value === 'object' && !Array.isArray(value));
  if (
    !data ||
    typeof data !== 'object' ||
    !isWindow(data.five_hour) ||
    !isWindow(data.seven_day) ||
    (!data.five_hour && !data.seven_day)
  ) {
    return { status: 'unexpected_response' };
  }

  const pick = (value) =>
    value ? { utilization: value.utilization, resets_at: value.resets_at } : null;

  // e.g. "claude_team" becomes "team"; the panel capitalizes it.
  const subscription = organization.analytics_subscription_plan;
  const plan =
    typeof subscription === 'string'
      ? subscription.replace('claude_', '')
      : typeof organization.raven_type === 'string'
        ? organization.raven_type
        : null;

  // Paid usage beyond the plan; amounts are in minor units, e.g. cents.
  const extra = data.extra_usage;

  return {
    status: 'ok',
    plan,
    five_hour: pick(data.five_hour),
    seven_day: pick(data.seven_day),
    extra: extra
      ? {
          kind: 'spend',
          enabled: extra.is_enabled,
          used_minor: extra.used_credits,
          limit_minor: extra.monthly_limit,
          decimal_places: extra.decimal_places,
          currency: extra.currency,
        }
      : null,
  };
};
