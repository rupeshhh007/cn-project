import assert from "node:assert/strict";
import test from "node:test";
import { buildInvitationUrl, createNetworkConfig, normalizeLanInterfaces, selectPublicOrigin } from "../src/network.ts";

test("hosted invitations use only the configured HTTPS origin, not private interfaces or forged hosts",() => {
  const interfaces=normalizeLanInterfaces([{name:"docker0",address:"10.0.0.5"}],"http",10000);
  const config=createNetworkConfig("http",10000,interfaces,"https://hopnet.example.com");
  assert.equal(config.mode,"hosted");assert.equal(config.secure,true);assert.equal(config.port,443);
  assert.deepEqual(config.interfaces,[]);assert.equal(selectPublicOrigin(config),"https://hopnet.example.com");
  assert.equal(selectPublicOrigin(config,"https://hopnet.example.com/"),"https://hopnet.example.com");
  assert.equal(selectPublicOrigin(config,"http://10.0.0.5:10000"),null);
  assert.equal(selectPublicOrigin(config,"https://evil.example.com"),null);
  for(const invalid of ["http://hopnet.example.com","https://user:password@hopnet.example.com","https://hopnet.example.com/path","https://hopnet.example.com/?secret=value","https://hopnet.example.com/#fragment"]) assert.throws(()=>createNetworkConfig("http",10000,interfaces,invalid));
});

test("LAN interfaces prefer a private Wi-Fi address over tunnel adapters", () => {
  const interfaces = normalizeLanInterfaces([
    { name: "utun4", address: "10.8.0.2" },
    { name: "en0", address: "192.168.1.42" },
    { name: "lo0", address: "127.0.0.1" },
    { name: "en7", address: "169.254.8.3" },
  ], "https", 4173);

  assert.deepEqual(interfaces.map(({ name, address, recommended }) => ({ name, address, recommended })), [
    { name: "en0", address: "192.168.1.42", recommended: true },
    { name: "en7", address: "169.254.8.3", recommended: false },
    { name: "utun4", address: "10.8.0.2", recommended: false },
  ]);
  assert.equal(interfaces[0]?.origin, "https://192.168.1.42:4173");
});

test("public invitation origins are restricted to detected coordinator interfaces", () => {
  const interfaces = normalizeLanInterfaces([{ name: "en0", address: "192.168.4.20" }], "http", 4173);
  const config = createNetworkConfig("http", 4173, interfaces);

  assert.equal(selectPublicOrigin(config), "http://192.168.4.20:4173");
  assert.equal(selectPublicOrigin(config, "http://192.168.4.20:4173"), "http://192.168.4.20:4173");
  assert.equal(selectPublicOrigin(config, "http://attacker.invalid:4173"), null);
  assert.equal(selectPublicOrigin(config, "http://192.168.4.20:4173/path"), null);
  assert.equal(selectPublicOrigin(config, "http://user:password@192.168.4.20:4173"), null);
});

test("invitation URLs preserve the selected LAN origin and encode credentials", () => {
  assert.equal(
    buildInvitationUrl("https://192.168.1.8:4173", "room/a", "secret + value"),
    "https://192.168.1.8:4173/?room=room%2Fa&invite=secret+%2B+value",
  );
});
