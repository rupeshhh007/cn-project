import { buildApp } from "./app.ts";
import { createNetworkConfig, discoverLanInterfaces } from "./network.ts";

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";
const app = await buildApp({ port });
await app.listen({ port, host });

const protocol = process.env.HOPNET_TLS_CERT && process.env.HOPNET_TLS_KEY ? "https" : "http";
const network = createNetworkConfig(protocol, port, discoverLanInterfaces(protocol, port));
console.log("\nHOPNET coordinator is ready");
console.log(`Local: ${protocol}://localhost:${port}`);
for (const item of network.interfaces) console.log(`${item.recommended ? "LAN*: " : "LAN:  "} ${item.origin}  (${item.name}, ${item.kind})`);
if (!network.preferredOrigin) console.warn("No non-loopback IPv4 interface was detected. Connect Wi-Fi or a hotspot, then restart HOPNET.");
if (protocol === "http") console.log("HTTP LAN mode is not a secure browser context. Use `npm run doctor` and trusted HTTPS before integrity-verified file transfer.");
console.log("Preflight: npm run doctor");
