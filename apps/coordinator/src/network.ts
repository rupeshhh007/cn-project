import os from "node:os";

export type LanInterface = {
  id: string;
  name: string;
  address: string;
  origin: string;
  kind: "private" | "link-local" | "other";
  recommended: boolean;
};

export type NetworkConfig = {
  mode: "lan" | "hosted";
  protocol: "http" | "https";
  port: number;
  interfaces: LanInterface[];
  preferredOrigin: string | null;
  localOrigin: string;
  secure: boolean;
};

export function discoverLanInterfaces(protocol: "http" | "https", port: number): LanInterface[] {
  const interfaces = Object.entries(os.networkInterfaces()).flatMap(([name, entries]) =>
    (entries ?? [])
      .filter((entry) => entry.family === "IPv4" && !entry.internal)
      .map((entry) => ({ name, address: entry.address })),
  );
  return normalizeLanInterfaces(interfaces, protocol, port);
}

export function normalizeLanInterfaces(
  interfaces: Array<{ name: string; address: string }>,
  protocol: "http" | "https",
  port: number,
): LanInterface[] {
  const unique = new Map<string, { name: string; address: string }>();
  for (const item of interfaces) {
    if (!isIpv4(item.address) || item.address.startsWith("127.")) continue;
    unique.set(`${item.name}\u0000${item.address}`, item);
  }
  const ranked = [...unique.values()]
    .map((item) => ({ ...item, kind: addressKind(item.address), score: interfaceScore(item.name, item.address) }))
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name) || left.address.localeCompare(right.address));
  return ranked.map((item, index) => ({
    id: Buffer.from(`${item.name}\u0000${item.address}`).toString("base64url"),
    name: item.name,
    address: item.address,
    origin: `${protocol}://${item.address}:${port}`,
    kind: item.kind,
    recommended: index === 0,
  }));
}

export function createNetworkConfig(
  protocol: "http" | "https",
  port: number,
  interfaces = discoverLanInterfaces(protocol, port),
  publicOrigin?: string,
): NetworkConfig {
  if (publicOrigin) {
    const url = new URL(publicOrigin);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Hosted HOPNET requires a trusted HTTPS origin without a path or credentials.");
    // TLS terminates at the hosting proxy. Never publish its private interfaces
    // or derive invitations from untrusted Host/Forwarded request headers.
    return { mode: "hosted", protocol: "https", port: Number(url.port || 443), interfaces: [], preferredOrigin: url.origin, localOrigin: url.origin, secure: true };
  }
  return {
    mode: "lan",
    protocol,
    port,
    interfaces,
    preferredOrigin: interfaces[0]?.origin ?? null,
    localOrigin: `${protocol}://localhost:${port}`,
    secure: protocol === "https",
  };
}

export function selectPublicOrigin(config: NetworkConfig, requestedOrigin?: string): string | null {
  const allowed = new Set(config.interfaces.map((item) => item.origin));
  if (config.mode === "hosted" && config.preferredOrigin) allowed.add(config.preferredOrigin);
  if (!requestedOrigin) return config.preferredOrigin;
  let normalized: string;
  try {
    const url = new URL(requestedOrigin);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    normalized = url.origin;
  } catch {
    return null;
  }
  return allowed.has(normalized) ? normalized : null;
}

export function buildInvitationUrl(origin: string, roomId: string, inviteSecret: string): string {
  const url = new URL(origin);
  url.pathname = "/";
  url.searchParams.set("room", roomId);
  url.searchParams.set("invite", inviteSecret);
  return url.toString();
}

function addressKind(address: string): LanInterface["kind"] {
  const octets = address.split(".").map(Number);
  if (octets[0] === 10 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168)) return "private";
  if (octets[0] === 169 && octets[1] === 254) return "link-local";
  return "other";
}

function interfaceScore(name: string, address: string): number {
  const kind = addressKind(address);
  let score = kind === "private" ? 100 : kind === "link-local" ? 20 : 40;
  if (/^(en0|en1|wi-?fi|wlan)/i.test(name)) score += 40;
  if (/^(utun|tun|tap|bridge|docker|vbox|vmnet|tailscale)/i.test(name)) score -= 80;
  return score;
}

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}
