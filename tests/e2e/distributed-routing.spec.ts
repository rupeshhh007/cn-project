import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.use({ trace: "off" });

async function evidence(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export router evidence", exact: true }).click();
  const stream = await (await waiting).createReadStream();
  let json = "";
  for await (const chunk of stream!) json += chunk.toString();
  return JSON.parse(json);
}

test("four RTC routers flood their own LSDBs and reconverge after an actual relay closes", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })));
  const errors: string[] = [];
  try {
    const [host, one, two, receiver] = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of [host, one, two, receiver]) page.on("pageerror", (error) => errors.push(error.message));
    await host.goto("/");
    await host.getByLabel("Device name").fill("Source");
    await host.getByRole("button", { name: "Create private room" }).click();
    const qr = await host.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
    const parsed = qr!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/)!;
    for (const [page, name] of [[one, "Relay One"], [two, "Relay Two"], [receiver, "Destination"]] as const) {
      await page.goto(`/?room=${parsed[1]}&invite=${parsed[2]}`);
      await page.getByLabel("Device name").fill(name);
      await page.getByRole("button", { name: "Request to join" }).click();
      await host.getByRole("button", { name: "Admit", exact: true }).click();
      await expect(page.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    }
    await host.getByRole("button", { name: "Open lab view" }).click();
    for (const [a, b] of [["Source", "Destination"], ["Relay One", "Destination"], ["Relay Two", "Destination"]]) {
      await host.getByRole("button", { name: new RegExp(`^(${a} ↔ ${b}|${b} ↔ ${a})$`) }).click();
    }
    await host.getByRole("button", { name: "Open routing view" }).click();
    await expect.poll(async () => (await evidence(host)).snapshots.filter((s: any) => s.lsdb.length === 4 && s.table.length === 3).length, { timeout: 20_000 }).toBe(4);
    const before = await evidence(host);
    await host.screenshot({ path: path.resolve("docs/screenshots/hopnet-four-router-lsdb.png"), animations: "disabled" });
    const source = before.snapshots.find((s: any) => s.id === before.observer);
    const destinationId = before.snapshots.find((s: any) => s.id !== source.id && s.neighbors.filter((n: any) => n.active).length === 2 && !s.neighbors.some((n: any) => n.id === source.id && n.active)).id;
    const oldHop = source.table.find((r: any) => r.destination === destinationId).nextHop;
    // Select the actual next-hop router by its exported identity, not an assumed UUID ordering.
    await one.getByRole("button", { name: "Open routing view" }).click();
    const oneId = (await evidence(one)).observer;
    await contexts[oldHop === oneId ? 1 : 2]!.close();
    await expect.poll(async () => {
      const e = await evidence(host);
      return e.snapshots.find((s: any) => s.id === e.observer).table.find((r: any) => r.destination === destinationId)?.nextHop;
    }, { timeout: 20_000 }).not.toBe(oldHop);
    const after = await evidence(host);
    const newRoute = after.snapshots.find((s: any) => s.id === after.observer).table.find((r: any) => r.destination === destinationId);
    expect(newRoute?.path).toHaveLength(3);
    await receiver.getByRole("button", { name: "Open send view" }).click();
    await receiver.locator(".conversation-peers").getByRole("button", { name: /^Source/ }).click();
    await host.getByRole("button", { name: "Open space view" }).click();
    await host.getByRole("button", { name: /^Destination,/ }).click();
    await host.getByPlaceholder("Message this peer…").fill("distributed forwarding after relay loss");
    await host.getByRole("button", { name: "Send", exact: true }).click();
    await expect(receiver.getByLabel("Conversation history").getByText("distributed forwarding after relay loss", { exact: true })).toBeVisible();
    await host.getByRole("button", { name: "Open send view" }).click();
    await expect(host.getByLabel("Conversation history").getByText(/You.*delivered/)).toBeVisible();
    await host.getByRole("button", { name: "Open routing view" }).click();
    const afterDelivery = await evidence(host);
    await mkdir(path.resolve("docs/evidence"), { recursive: true });
    const proof = JSON.stringify({ provenance: "AUTOMATED CHROME WEBRTC — NOT PHYSICAL DEVICES", before, after, afterDelivery, runtimeErrors: errors }, null, 2);
    await writeFile(path.resolve("docs/evidence/distributed-routing.json"), proof);
    await testInfo.attach("distributed-routing.json", { body: proof, contentType: "application/json" });
    await host.screenshot({ path: path.resolve("docs/screenshots/hopnet-distributed-routing.png"), animations: "disabled" });
    for (const [width,height] of [[1920,1080],[1440,900],[1280,720],[768,1024],[430,932],[390,844]]) {
      await host.setViewportSize({ width:width!,height:height! });
      if (width! <= 680) await host.getByRole("button", { name:"Routing",exact:true }).click();
      await expect(host.getByRole("heading", { name:"Every peer, a router." })).toBeVisible();
      await expect(host.getByRole("table", { name:"Local forwarding table" })).toBeVisible();
      expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await host.screenshot({ path:path.resolve(`docs/screenshots/hopnet-routing-${width}x${height}.png`),animations:"disabled" });
    }
    await host.setViewportSize({ width:1440,height:900 });
    await host.getByRole("button", { name:"Open replay view" }).click();
    await host.getByLabel("Protocol event filter").selectOption("control");
    await expect(host.getByLabel("Recorded protocol events").getByRole("button").first()).toBeVisible();
    await host.getByLabel("Protocol event filter").selectOption("data");
    await expect(host.getByLabel("Recorded protocol events").getByRole("button").first()).toBeVisible();
    await host.getByRole("button", { name:"Next event",exact:true }).click();
    await host.locator(".routing-replay-details summary").click();
    await expect(host.locator(".routing-replay-details")).toContainText("LSA origins");
    await host.screenshot({ path:path.resolve("docs/screenshots/hopnet-routing-replay.png"),animations:"disabled" });
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});
