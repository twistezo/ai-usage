import { getVersion } from "@tauri-apps/api/app";

const version = document.querySelector<HTMLElement>("#version");

if (version) {
  void getVersion().then((value) => {
    version.textContent = `Version ${value} · `;
  });
}
