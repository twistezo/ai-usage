import { fitWindowToContent } from "./window-size";

// Must match the info window width in src-tauri/src/lib.rs.
const INFO_WINDOW_WIDTH = 440;

const page = document.querySelector<HTMLElement>(".info-page");

if (page) {
  void fitWindowToContent(page, INFO_WINDOW_WIDTH);
}
