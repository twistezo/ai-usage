import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

const RESIZE_WAIT_MS = 300;

// Windows with a title bar count it into the size; learned once, then reused.
let frameOffset = 0;

const waitForResize = (): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      window.removeEventListener("resize", done);
      resolve();
    };
    window.addEventListener("resize", done);
    window.setTimeout(done, RESIZE_WAIT_MS);
  });

// Window height follows its content; the width stays fixed.
export const fitWindowToContent = async (root: HTMLElement, width: number): Promise<void> => {
  const height = Math.ceil(root.getBoundingClientRect().height);
  const current = getCurrentWindow();

  await current.setSize(new LogicalSize(width, height + frameOffset));
  await waitForResize();

  const missing = height - window.innerHeight;
  if (missing > 0) {
    frameOffset += missing;
    await current.setSize(new LogicalSize(width, height + frameOffset));
  }
};
