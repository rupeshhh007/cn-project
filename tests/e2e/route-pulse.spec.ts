import { expect, test, type Page } from "@playwright/test";
import { writeFile } from "node:fs/promises";

test.use({ trace: "off" });

async function pulseExport(page: Page) {
  const waiting = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export pulses", exact: true }).click();
  const stream = await (await waiting).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test("Route Pulse reports actual WebRTC hop trails, changes branch after a fault and stays usable on mobile", async ({ browser }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  const contexts = await Promise.all([0,1,2,3].map(() => browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })));
  try {
    const [host, relay1, relay2, receiver] = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of [host,relay1,relay2,receiver]) {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    }
    await host.goto("/");
    expect(await host.title()).toContain("HOPNET");
    await host.getByLabel("Device name").fill("Source Mac");
    await host.getByRole("button", { name: "Create private room" }).click();
    const source = await host.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
    const invitation = source!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/)!;
    for (const [page,name,category] of [[relay1,"Relay One","phone"],[relay2,"Relay Two","phone"],[receiver,"Destination Mac","laptop"]] as const) {
      await page.goto(`/?room=${invitation[1]}&invite=${invitation[2]}`);
      await page.getByLabel("Device name").fill(name);
      await page.getByLabel("Device type").selectOption(category);
      await page.getByRole("button", { name: "Request to join" }).click();
      await host.getByRole("button", { name: "Admit", exact: true }).click();
      await expect(page.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    }
    await host.getByRole("button", { name: "Open lab view" }).click();
    await host.getByLabel("Experiment receiver").selectOption({ label: "Destination Mac" });
    const edge = (a:string,b:string) => host.getByRole("button", { name: new RegExp(`^(${a} ↔ ${b}|${b} ↔ ${a})`) });
    await edge("Source Mac","Destination Mac").click();
    await edge("Relay One","Destination Mac").click();await edge("Relay Two","Destination Mac").click();
    await expect(host.getByLabel("Available experiment routes").getByText("2 established routes", { exact: true })).toBeVisible({ timeout:15_000 });
    await host.getByRole("button", { name: "Open routing view" }).click();
    await host.getByLabel("Pulse receiver").selectOption({ label: "Destination Mac" });
    await host.getByRole("button", { name: "Send route pulse", exact: true }).click();
    const panel = host.getByRole("region", { name: "Route Pulse", exact: true });
    await expect(panel.getByText("Receipt returned", { exact: true })).toBeVisible();
    await expect(panel.getByRole("list", { name: "Receiver-reported outward route" }).locator("li")).toHaveCount(3);
    const first = await pulseExport(host), firstPulse = first.pulses[0];
    expect(firstPulse.status).toBe("received");expect(firstPulse.outboundPath).toHaveLength(3);expect(firstPulse.returnPath).toHaveLength(3);
    expect(firstPulse.roundTripMs).toBeGreaterThanOrEqual(0);
    const failedName = first.peers.find((peer:{id:string}) => peer.id === firstPulse.outboundPath[1]).displayName;
    await host.getByRole("button", { name: "Open lab view" }).click();
    await host.getByLabel("Failure relay").selectOption({ label:failedName });
    await host.getByRole("button", { name: "Disconnect relay links", exact:true }).click();
    await expect(host.getByLabel("Available experiment routes").getByText("1 established route", { exact:true })).toBeVisible({timeout:15_000});
    await host.getByRole("button", { name: "Open routing view" }).click();
    await host.getByRole("button", { name: "Send route pulse", exact:true }).click();
    await expect(panel.getByText("Path changed", { exact:true })).toBeVisible();
    const after = await pulseExport(host);
    expect(after.pulses).toHaveLength(2);expect(after.pulses[0].outboundPath[1]).not.toBe(firstPulse.outboundPath[1]);
    expect(after.pulses[0].outboundPath[0]).toBe(firstPulse.outboundPath[0]);
    expect(after.pulses[0].outboundPath.at(-1)).toBe(firstPulse.outboundPath.at(-1));
    expect(JSON.stringify(after)).not.toMatch(/sessionToken|hostToken|claimToken|inviteSecret|privateKey/);
    await writeFile("/tmp/hopnet-route-pulse-evidence.json",JSON.stringify({provenance:"AUTOMATED CHROME WEBRTC; FOUR LOGICAL BROWSER ROUTERS",fault:"Host removed the selected relay's permitted links",before:first,after},null,2));
    await panel.scrollIntoViewIfNeeded();
    await host.screenshot({path:"/tmp/hopnet-route-pulse-desktop.png",animations:"disabled"});
    await host.setViewportSize({width:390,height:844});
    await host.getByRole("button",{name:"Routing",exact:true}).click();
    await expect(panel.getByText("Path changed",{exact:true})).toBeVisible();
    await panel.getByRole("list",{name:"Receiver-reported outward route"}).scrollIntoViewIfNeeded();
    await host.screenshot({path:"/tmp/hopnet-route-pulse-mobile.png",animations:"disabled"});
    expect(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await host.getByRole("button",{name:"Messages",exact:true}).click();
    await expect(host.getByLabel("Conversation history").locator("article")).toHaveCount(0);
    await receiver.getByRole("button",{name:"Open send view"}).click();
    await expect(receiver.getByLabel("Conversation history").locator("article")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await Promise.all(contexts.map((context)=>context.close())); }
});
