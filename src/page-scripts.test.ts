import { describe, expect, it, vi } from "vitest";

// The real scripts the app injects into the hidden claude.ai and chatgpt.com pages.
import claudeScript from "../src-tauri/scripts/claude.js?raw";
import codexScript from "../src-tauri/scripts/codex.js?raw";
import reportScript from "../src-tauri/scripts/report.js?raw";
import { parseReaderOutput } from "./reader";

type FetchResult = { ok: true; data: unknown } | { ok: false; status: number };
type FetchJson = (path: string, headers?: Record<string, string>) => Promise<FetchResult>;
type Report = Record<string, unknown>;
type ReadUsage = () => Promise<Report>;

const ok = (data: unknown): FetchResult => ({ ok: true, data });
const failed = (status: number): FetchResult => ({ ok: false, status });

// Runs a provider script with `fetchJson` answering from a fixed table of API responses.
const loadReader = (
  script: string,
  responses: Record<string, FetchResult>,
): { readUsage: ReadUsage; calls: { path: string; headers: Record<string, string> }[] } => {
  const calls: { path: string; headers: Record<string, string> }[] = [];
  const fetchJson: FetchJson = async (path, headers = {}) => {
    calls.push({ path, headers });
    const response = responses[path];
    if (!response) {
      throw new TypeError(`Unexpected request: ${path}`);
    }

    return response;
  };
  // The scripts are plain page JavaScript, so they are compiled the way the page would run them.
  const readUsage = new Function("fetchJson", `${script}\nreturn readUsage;`)(fetchJson) as ReadUsage;

  return { readUsage, calls };
};

const claudeUsage = {
  five_hour: { utilization: 13, resets_at: "2026-10-29T20:49:59.852490+00:00", limit_dollars: null },
  seven_day: { utilization: 38, resets_at: "2026-11-01T13:59:59.643011+00:00", limit_dollars: null },
  extra_usage: {
    is_enabled: true,
    monthly_limit: 150,
    used_credits: 118,
    decimal_places: 2,
    currency: "EUR",
  },
};

const teamOrganization = {
  uuid: "org-team",
  capabilities: ["raven", "chat"],
  analytics_subscription_plan: "claude_team",
  raven_type: "team",
};

describe("claude.js", () => {
  it("reads the organization's limits, plan and extra spend", async () => {
    const { readUsage } = loadReader(claudeScript, {
      "/api/organizations": ok([teamOrganization]),
      "/api/organizations/org-team/usage": ok(claudeUsage),
    });

    expect(await readUsage()).toEqual({
      status: "ok",
      plan: "team",
      five_hour: { utilization: 13, resets_at: "2026-10-29T20:49:59.852490+00:00" },
      seven_day: { utilization: 38, resets_at: "2026-11-01T13:59:59.643011+00:00" },
      extra: {
        kind: "spend",
        enabled: true,
        used_minor: 118,
        limit_minor: 150,
        decimal_places: 2,
        currency: "EUR",
      },
    });
  });

  it("prefers an organization with chat over an API-only one", async () => {
    const { readUsage, calls } = loadReader(claudeScript, {
      "/api/organizations": ok([{ uuid: "org-api", capabilities: ["api"] }, teamOrganization]),
      "/api/organizations/org-team/usage": ok(claudeUsage),
    });

    await readUsage();

    expect(calls.map((call) => call.path)).toEqual(["/api/organizations", "/api/organizations/org-team/usage"]);
  });

  it("falls back to the first organization when none has chat", async () => {
    const { readUsage, calls } = loadReader(claudeScript, {
      "/api/organizations": ok([{ uuid: "org-first" }, { uuid: "org-second" }]),
      "/api/organizations/org-first/usage": ok(claudeUsage),
    });

    await readUsage();

    expect(calls[1].path).toBe("/api/organizations/org-first/usage");
  });

  it("encodes the organization id so it cannot change the request path", async () => {
    const { readUsage, calls } = loadReader(claudeScript, {
      "/api/organizations": ok([{ uuid: "../../account", capabilities: ["chat"] }]),
      "/api/organizations/..%2F..%2Faccount/usage": ok(claudeUsage),
    });

    await readUsage();

    expect(calls[1].path).toBe("/api/organizations/..%2F..%2Faccount/usage");
  });

  it("falls back to raven_type for the plan, then to none", async () => {
    const planFor = async (organization: Report): Promise<unknown> => {
      const { readUsage } = loadReader(claudeScript, {
        "/api/organizations": ok([{ uuid: "org", capabilities: ["chat"], ...organization }]),
        "/api/organizations/org/usage": ok(claudeUsage),
      });

      return (await readUsage()).plan;
    };

    expect(await planFor({ raven_type: "enterprise" })).toBe("enterprise");
    expect(await planFor({})).toBeNull();
  });

  it("reports no extra usage when the account has none", async () => {
    const { readUsage } = loadReader(claudeScript, {
      "/api/organizations": ok([teamOrganization]),
      "/api/organizations/org-team/usage": ok({ ...claudeUsage, extra_usage: null }),
    });

    expect((await readUsage()).extra).toBeNull();
  });

  it("reports a rejected organization list, e.g. when logged out", async () => {
    const { readUsage } = loadReader(claudeScript, { "/api/organizations": failed(403) });

    expect(await readUsage()).toEqual({ status: "http_error", step: "organizations", http_status: 403 });
  });

  it("reports a rejected usage request", async () => {
    const { readUsage } = loadReader(claudeScript, {
      "/api/organizations": ok([teamOrganization]),
      "/api/organizations/org-team/usage": failed(401),
    });

    expect(await readUsage()).toEqual({ status: "http_error", step: "usage", http_status: 401 });
  });

  it.each([
    ["an empty organization list", []],
    ["something other than a list", { organizations: [] }],
    ["an organization without id", [{ capabilities: ["chat"] }]],
  ])("stops on %s without asking for usage", async (_, organizations) => {
    const { readUsage, calls } = loadReader(claudeScript, { "/api/organizations": ok(organizations) });

    expect(await readUsage()).toEqual({ status: "unexpected_response" });
    expect(calls).toHaveLength(1);
  });
});

const codexUsage = {
  plan_type: "plus",
  rate_limit: {
    primary_window: { used_percent: 34, limit_window_seconds: 18000, reset_at: 1793306946 },
    secondary_window: { used_percent: 27, limit_window_seconds: 604800, reset_at: 1793788010 },
  },
  credits: { has_credits: false, unlimited: false, balance: "0" },
};

const codexSession = { accessToken: "secret-session-token", account: { id: "account-1" } };

describe("codex.js", () => {
  it("reads both windows, plan and credits", async () => {
    const { readUsage } = loadReader(codexScript, {
      "/api/auth/session": ok(codexSession),
      "/backend-api/wham/usage": ok(codexUsage),
    });

    expect(await readUsage()).toEqual({
      status: "ok",
      plan: "plus",
      five_hour: { utilization: 34, resets_at: new Date(1793306946 * 1000).toISOString() },
      seven_day: { utilization: 27, resets_at: new Date(1793788010 * 1000).toISOString() },
      extra: { kind: "credits", unlimited: false, balance: "0" },
    });
  });

  it("calls the usage endpoint with the session token and account", async () => {
    const { readUsage, calls } = loadReader(codexScript, {
      "/api/auth/session": ok(codexSession),
      "/backend-api/wham/usage": ok(codexUsage),
    });

    await readUsage();

    expect(calls[1].headers).toEqual({
      Authorization: "Bearer secret-session-token",
      "ChatGPT-Account-Id": "account-1",
    });
  });

  it("never puts the session token or account id into the report", async () => {
    const { readUsage } = loadReader(codexScript, {
      "/api/auth/session": ok(codexSession),
      "/backend-api/wham/usage": ok(codexUsage),
    });

    const serialized = JSON.stringify(await readUsage());

    expect(serialized).not.toContain("secret-session-token");
    expect(serialized).not.toContain("account-1");
  });

  it("skips the account header when the session has no account", async () => {
    const { readUsage, calls } = loadReader(codexScript, {
      "/api/auth/session": ok({ accessToken: "token" }),
      "/backend-api/wham/usage": ok(codexUsage),
    });

    await readUsage();

    expect(calls[1].headers).toEqual({ Authorization: "Bearer token" });
  });

  it("matches windows by length, not by their order", async () => {
    const { readUsage } = loadReader(codexScript, {
      "/api/auth/session": ok(codexSession),
      "/backend-api/wham/usage": ok({
        ...codexUsage,
        rate_limit: {
          primary_window: codexUsage.rate_limit.secondary_window,
          secondary_window: codexUsage.rate_limit.primary_window,
        },
      }),
    });

    const report = await readUsage();

    expect([report.five_hour, report.seven_day]).toEqual([
      expect.objectContaining({ utilization: 34 }),
      expect.objectContaining({ utilization: 27 }),
    ]);
  });

  it("keeps one known window when the other is missing", async () => {
    const { readUsage } = loadReader(codexScript, {
      "/api/auth/session": ok(codexSession),
      "/backend-api/wham/usage": ok({
        ...codexUsage,
        rate_limit: { primary_window: codexUsage.rate_limit.primary_window },
      }),
    });

    const report = await readUsage();

    expect(report.status).toBe("ok");
    expect(report.seven_day).toBeNull();
  });

  it("reports a format change instead of 0% when no window length is known", async () => {
    const { readUsage } = loadReader(codexScript, {
      "/api/auth/session": ok(codexSession),
      "/backend-api/wham/usage": ok({
        ...codexUsage,
        rate_limit: { primary_window: { used_percent: 50, limit_window_seconds: 3600, reset_at: 1 } },
      }),
    });

    expect(await readUsage()).toEqual({ status: "unexpected_response" });
  });

  it("reports a missing rate limit as a format change", async () => {
    const { readUsage } = loadReader(codexScript, {
      "/api/auth/session": ok(codexSession),
      "/backend-api/wham/usage": ok({ plan_type: "plus" }),
    });

    expect(await readUsage()).toEqual({ status: "unexpected_response" });
  });

  it("treats a session without token as logged out and asks for nothing else", async () => {
    const { readUsage, calls } = loadReader(codexScript, { "/api/auth/session": ok({}) });

    expect(await readUsage()).toEqual({ status: "http_error", step: "session", http_status: 401 });
    expect(calls).toHaveLength(1);
  });

  it("reports a failed session request and a rejected usage request", async () => {
    const session = loadReader(codexScript, { "/api/auth/session": failed(500) });
    const usage = loadReader(codexScript, {
      "/api/auth/session": ok(codexSession),
      "/backend-api/wham/usage": failed(403),
    });

    expect(await session.readUsage()).toEqual({ status: "http_error", step: "session", http_status: 500 });
    expect(await usage.readUsage()).toEqual({ status: "http_error", step: "usage", http_status: 403 });
  });
});

describe("page script reports, as the panel parses them", () => {
  it("turns a Codex reading into panel data", async () => {
    const { readUsage } = loadReader(codexScript, {
      "/api/auth/session": ok(codexSession),
      "/backend-api/wham/usage": ok(codexUsage),
    });

    const result = parseReaderOutput(JSON.stringify(await readUsage()));

    expect(result).toEqual({
      kind: "ok",
      plan: "plus",
      fiveHour: { utilization: 34, resetsAt: new Date(1793306946 * 1000) },
      sevenDay: { utilization: 27, resetsAt: new Date(1793788010 * 1000) },
      extra: { kind: "credits", unlimited: false, balance: 0 },
    });
  });

  it("turns a Claude reading into panel data", async () => {
    const { readUsage } = loadReader(claudeScript, {
      "/api/organizations": ok([teamOrganization]),
      "/api/organizations/org-team/usage": ok(claudeUsage),
    });

    const result = parseReaderOutput(JSON.stringify(await readUsage()));

    expect(result.kind === "ok" && result.extra).toEqual({
      kind: "spend",
      enabled: true,
      used: 1.18,
      limit: 1.5,
      currency: "EUR",
      decimals: 2,
    });
  });
});

const TITLE_PREFIX = "__AIUSAGE__";
// WebKit cuts longer titles, which would corrupt the report.
const WEBKIT_TITLE_LIMIT = 1000;

// Runs report.js against a fake page: its title and timers.
const runReport = (readUsage: () => Promise<unknown>): { page: { title: string }; timers: (() => void)[] } => {
  const page = { title: "Claude" };
  const timers: (() => void)[] = [];
  new Function("readUsage", "document", "setTimeout", reportScript)(readUsage, page, (callback: () => void) =>
    timers.push(callback),
  );

  return { page, timers };
};

describe("report.js", () => {
  it("hands the result over through the page title and restores the title", async () => {
    const { page, timers } = runReport(async () => ({ status: "ok", plan: "team" }));

    await vi.waitFor(() => expect(page.title).toBe(`${TITLE_PREFIX}{"status":"ok","plan":"team"}`));
    timers.forEach((timer) => timer());

    expect(page.title).toBe("Claude");
  });

  it("reports a changed response format when the page returns non-JSON", async () => {
    const { page } = runReport(async () => {
      throw new SyntaxError("Unexpected token <");
    });

    await vi.waitFor(() => expect(page.title).toBe(`${TITLE_PREFIX}{"status":"unexpected_response"}`));
  });

  it("reports a network failure for any other error", async () => {
    const { page } = runReport(async () => {
      throw new TypeError("Failed to fetch");
    });

    await vi.waitFor(() => expect(page.title).toBe(`${TITLE_PREFIX}{"status":"network_error"}`));
  });

  it("keeps the largest real report within the WebKit title limit", async () => {
    const { readUsage } = loadReader(claudeScript, {
      "/api/organizations": ok([teamOrganization]),
      "/api/organizations/org-team/usage": ok(claudeUsage),
    });
    const { page } = runReport(readUsage);

    await vi.waitFor(() => expect(page.title.startsWith(TITLE_PREFIX)).toBe(true));

    expect(page.title.length).toBeLessThan(WEBKIT_TITLE_LIMIT);
  });
});
