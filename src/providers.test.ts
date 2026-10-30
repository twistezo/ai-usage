import { describe, expect, it } from "vitest";

import { readEnabledProviders, saveEnabledProviders, toggleProvider } from "./providers";

const storageWith = (value: string | null): Pick<Storage, "getItem"> => ({ getItem: () => value });

describe("reading the enabled providers", () => {
  it("enables everything on first launch", () => {
    expect(readEnabledProviders(storageWith(null))).toEqual(["codex", "claude"]);
  });

  it("restores a saved choice in the app's order", () => {
    expect(readEnabledProviders(storageWith('["claude"]'))).toEqual(["claude"]);
    expect(readEnabledProviders(storageWith('["claude","codex"]'))).toEqual(["codex", "claude"]);
  });

  it("ignores unknown and repeated providers", () => {
    expect(readEnabledProviders(storageWith('["gemini","claude","claude"]'))).toEqual(["claude"]);
  });

  it.each([
    ["an empty list", "[]"],
    ["only unknown providers", '["gemini"]'],
    ["broken JSON", "[claude"],
    ["something other than a list", '{"claude":true}'],
  ])("falls back to all providers for %s", (_, stored) => {
    expect(readEnabledProviders(storageWith(stored))).toEqual(["codex", "claude"]);
  });

  it("falls back to all providers when storage is unavailable", () => {
    const failing = {
      getItem: () => {
        throw new Error("Storage disabled");
      },
    };

    expect(readEnabledProviders(failing)).toEqual(["codex", "claude"]);
  });
});

describe("saving the enabled providers", () => {
  it("round-trips through storage", () => {
    let stored: string | null = null;
    saveEnabledProviders({ setItem: (_, value) => void (stored = value) }, ["codex"]);

    expect(readEnabledProviders(storageWith(stored))).toEqual(["codex"]);
  });

  it("does not throw when storage is full", () => {
    const failing = {
      setItem: () => {
        throw new Error("Storage full");
      },
    };

    expect(() => saveEnabledProviders(failing, ["codex"])).not.toThrow();
  });
});

describe("toggling a provider", () => {
  it("turns an enabled provider off", () => {
    expect(toggleProvider(["codex", "claude"], "codex")).toEqual(["claude"]);
  });

  it("turns a disabled provider back on in the app's order", () => {
    expect(toggleProvider(["claude"], "codex")).toEqual(["codex", "claude"]);
  });

  it("refuses to turn off the last enabled provider", () => {
    expect(toggleProvider(["claude"], "claude")).toEqual(["claude"]);
  });
});
