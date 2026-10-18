import { buildApp, getLanAddresses } from "./app.ts";

const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? "0.0.0.0";
const app = await buildApp();
await app.listen({ port, host });

const protocol = process.env.HOPNET_TLS_CERT && process.env.HOPNET_TLS_KEY ? "https" : "http";
console.log("\nHOPNET coordinator is ready");
console.log(`Local: ${protocol}://localhost:${port}`);
for (const address of getLanAddresses()) console.log(`LAN:   ${protocol}://${address}:${port}`);
if (protocol === "http") console.log("LAN HTTP mode: WebRTC DataChannels work in major browsers, but some optional browser APIs require trusted HTTPS. See docs/DEVICE_TESTING.md.");
