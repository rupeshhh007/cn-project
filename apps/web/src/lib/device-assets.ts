import type { DeviceCategory } from "@hopnet/protocol";

/** One asset registry for the live canvas, conversations and historical replay. */
export function deviceAsset(category: DeviceCategory): { source: string; className: string } {
  if (category === "laptop") return { source: "/assets/devices/laptop-v2.png", className: "laptop" };
  if (category === "phone") return { source: "/assets/devices/phone-v2.png", className: "phone" };
  if (category === "tablet") return { source: "/assets/devices/tablet.webp", className: "tablet" };
  return { source: "/assets/devices/node.webp", className: "node" };
}
