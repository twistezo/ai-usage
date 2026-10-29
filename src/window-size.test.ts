// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake window whose page area is the requested height minus an optional title bar.
const windowState = { titleBar: 0, sizes: [] as number[] };

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    setSize: async (size: { height: number }) => {
      windowState.sizes.push(size.height);
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: size.height - windowState.titleBar,
      });
      window.dispatchEvent(new Event("resize"));
    },
  }),
}));

vi.mock("@tauri-apps/api/dpi", () => ({
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));

const contentOf = (height: number): HTMLElement => {
  const root = document.createElement("main");
  root.getBoundingClientRect = () => ({ height }) as DOMRect;

  return root;
};

// The module learns the title bar height once, so each test starts with a fresh copy.
const loadFit = async (): Promise<typeof import("./window-size").fitWindowToContent> => {
  vi.resetModules();

  return (await import("./window-size")).fitWindowToContent;
};

beforeEach(() => {
  windowState.titleBar = 0;
  windowState.sizes = [];
});

describe("fitWindowToContent", () => {
  it("sizes a window without a title bar exactly to its content", async () => {
    const fit = await loadFit();

    await fit(contentOf(420), 340);

    expect(windowState.sizes).toEqual([420]);
    expect(window.innerHeight).toBe(420);
  });

  it("adds the title bar so the bottom of the content is not cut off", async () => {
    windowState.titleBar = 28;
    const fit = await loadFit();

    await fit(contentOf(420), 440);

    expect(window.innerHeight).toBe(420);
  });

  it("reuses the learned title bar height without resizing twice", async () => {
    windowState.titleBar = 28;
    const fit = await loadFit();
    await fit(contentOf(420), 440);
    windowState.sizes = [];

    await fit(contentOf(300), 440);

    expect(windowState.sizes).toEqual([328]);
    expect(window.innerHeight).toBe(300);
  });

  it("rounds a fractional content height up so nothing is cut off", async () => {
    const fit = await loadFit();

    await fit(contentOf(420.2), 340);

    expect(window.innerHeight).toBe(421);
  });
});
