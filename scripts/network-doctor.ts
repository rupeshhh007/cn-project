import fs from "node:fs";
import { X509Certificate } from "node:crypto";
import { createNetworkConfig, discoverLanInterfaces } from "../apps/coordinator/src/network.ts";

const port = Number(process.env.PORT ?? 4173);
const certPath = process.env.HOPNET_TLS_CERT;
const keyPath = process.env.HOPNET_TLS_KEY;
const protocol = certPath && keyPath ? "https" : "http";
const network = createNetworkConfig(protocol, port, discoverLanInterfaces(protocol, port));
let failed = false;

console.log("HOPNET Network Doctor\n");
if (!network.interfaces.length) {
  console.error("FAIL  No non-loopback IPv4 interface was found. Connect Wi-Fi or a hotspot and retry.");
  process.exitCode = 1;
} else {
  for (const item of network.interfaces) {
    console.log(`${item.recommended ? "USE " : "INFO"}  ${item.origin}  [${item.name}, ${item.kind}]`);
  }
}

if (protocol === "http") {
  console.warn("\nWARN  LAN HTTP can load the UI, but mobile browsers do not treat it as a secure context.");
  console.warn("      Use trusted HTTPS before testing cryptographic file integrity or other secure browser APIs.");
} else {
  for (const [label, file] of [["certificate", certPath], ["private key", keyPath]] as const) {
    if (!file || !fs.existsSync(file)) {
      failed = true;
      console.error(`FAIL  TLS ${label} is missing: ${file ?? "not configured"}`);
    }
  }
  if (!failed && certPath) {
    try {
      const certificate = new X509Certificate(fs.readFileSync(certPath));
      const host = network.preferredOrigin ? new URL(network.preferredOrigin).hostname : undefined;
      const matches = host ? certificate.checkIP(host) || certificate.checkHost(host) : undefined;
      if (host && !matches) {
        failed = true;
        console.error(`FAIL  The TLS certificate does not cover the recommended LAN address ${host}.`);
      } else {
        console.log(`\nPASS  TLS certificate is readable${host ? ` and covers ${host}` : ""}.`);
      }
    } catch (error) {
      failed = true;
      console.error(`FAIL  TLS certificate could not be parsed: ${error instanceof Error ? error.message : "unknown error"}`);
    }
  }
}

if (network.preferredOrigin) {
  console.log(`\nNext: start HOPNET, open ${network.preferredOrigin} on the host, and scan its room QR code from a second device.`);
  console.log("Physical verification remains pending until the second device loads, is admitted, and opens a direct RTCDataChannel.");
}
if (failed) process.exitCode = 1;
