// Tabler Icons (MIT), bundled as SVG markup; they inherit color from `currentColor`.
import appWindow from "@tabler/icons/outline/app-window.svg?raw";
import pin from "@tabler/icons/outline/pin.svg?raw";
import pinned from "@tabler/icons/outline/pinned.svg?raw";
import refresh from "@tabler/icons/outline/refresh.svg?raw";
import close from "@tabler/icons/outline/x.svg?raw";

export const ICONS = { appWindow, close, pin, pinned, refresh } as const;
export type IconName = keyof typeof ICONS;
