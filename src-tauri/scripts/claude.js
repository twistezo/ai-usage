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

  const usage = await fetchJson(
    '/api/organizations/' + encodeURIComponent(organization.uuid) + '/usage',
  );
  if (!usage.ok) {
    return { status: 'http_error', step: 'usage', http_status: usage.status };
  }

  const pick = (value) =>
    value ? { utilization: value.utilization, resets_at: value.resets_at } : null;

  // Paid usage beyond the plan; amounts are in minor units, e.g. cents.
  const extra = usage.data.extra_usage;

  return {
    status: 'ok',
    five_hour: pick(usage.data.five_hour),
    seven_day: pick(usage.data.seven_day),
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
