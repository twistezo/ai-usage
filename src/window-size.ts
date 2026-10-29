import { LogicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Window height follows its content; the width stays fixed.
export const fitWindowToContent = async (root: HTMLElement, width: number): Promise<void> => {
  const height = Math.ceil(root.getBoundingClientRect().height);
  await getCurrentWindow().setSize(new LogicalSize(width, height));
};
