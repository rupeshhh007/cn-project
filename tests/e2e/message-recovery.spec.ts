import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { RouterSnapshot } from "../../apps/web/src/lib/distributed-router.ts";

test.use({ trace:"off" });
async function downloadJson(page:Page, button:string) {
  const waiting=page.waitForEvent("download");
  await page.getByRole("button",{ name:button,exact:true }).click();
  const stream=await (await waiting).createReadStream();
  let raw=""; for await(const chunk of stream!) raw+=chunk.toString();
  return JSON.parse(raw);
}
type Observations={ observer:string; snapshots:RouterSnapshot[] };
type RecordedEvent={ type:string; path?:string[]; detail:string; monotonicMs:number };

test("a message already sent into a stalled relay recovers after that actual browser closes", async ({ browser },testInfo) => {
  test.setTimeout(120_000);
  const contexts=await Promise.all([0,1,2,3].map(() => browser.newContext({ viewport:{ width:1440,height:900 },acceptDownloads:true })));
  const errors:string[]=[];
  try {
    const pages=await Promise.all(contexts.map((context) => context.newPage()));
    const [host,one,,receiver]=pages as [Page,Page,Page,Page];
    for(const page of pages) {
      page.on("pageerror",(error) => errors.push(error.message));
      page.on("console",(message) => { if(message.type()==="error") errors.push(message.text()); });
    }
    await host.goto("/"); await expect(host).toHaveTitle(/HOPNET/);
    await expect(host.getByLabel("Device name")).toBeVisible({ timeout:10_000 });
    await host.getByLabel("Device name").fill("Source");
    await host.getByRole("button",{ name:"Create private room" }).click();
    const qr=await host.getByRole("img",{ name:"QR code to join this HOPNET room" }).getAttribute("src");
    const invitation=qr!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/)!;
    for(const [index,name] of [[1,"Relay One"],[2,"Relay Two"],[3,"Destination"]] as const) {
      const page=pages[index]!;
      await page.goto(`/?room=${invitation[1]}&invite=${invitation[2]}`);
      await page.getByLabel("Device name").fill(name);
      await page.getByRole("button",{ name:"Request to join" }).click();
      await host.getByRole("button",{ name:"Admit",exact:true }).click();
      await expect(page.getByText("Direct WebRTC",{ exact:true }).first()).toBeVisible({ timeout:15_000 });
    }
    await host.getByRole("button",{ name:"Open lab view" }).click();
    await host.getByLabel("Experiment receiver").selectOption({ label:"Destination" });
    for(const [a,b] of [["Source","Destination"],["Relay One","Destination"],["Relay Two","Destination"]])
      await host.getByRole("button",{ name:new RegExp(`^(${a} ↔ ${b}|${b} ↔ ${a})$`) }).click();
    await expect(host.getByLabel("Available experiment routes").getByText("2 established routes",{ exact:true })).toBeVisible({ timeout:20_000 });
    await host.getByRole("button",{ name:"Open routing view" }).click();
    await expect.poll(async () => {
      const observations=await downloadJson(host,"Export router evidence") as Observations;
      return observations.snapshots.length===4 && observations.snapshots.some((s) => s.id!==observations.observer && s.neighbors.some((n) => n.active) && !s.neighbors.some((n) => n.id===observations.observer && n.active));
    },{ timeout:15_000 }).toBe(true);
    const before:Observations=await downloadJson(host,"Export router evidence");
    const source=before.snapshots.find((s) => s.id===before.observer)!;
    const destination=before.snapshots.find((s) => s.id!==source.id && s.neighbors.some((n) => n.active) && !s.neighbors.some((n) => n.id===source.id && n.active))!;
    expect(destination).toBeTruthy();
    const failedHop=source.table.find((r) => r.destination===destination.id)!.nextHop;
    await one.getByRole("button",{ name:"Open routing view" }).click();
    const oneId=(await downloadJson(one,"Export router evidence") as Observations).observer;
    const failedIndex=failedHop===oneId?1:2;
    await receiver.getByRole("button",{ name:"Open send view" }).click();
    await receiver.locator(".conversation-peers").getByRole("button",{ name:/^Source/ }).click();
    await host.getByRole("button",{ name:"Open send view" }).click();
    await host.locator(".conversation-peers").getByRole("button",{ name:/^Destination/ }).click();
    const body="Exactly once through a mid-message relay failure";
    await host.getByPlaceholder("Message this peer…").fill(body);
    // Real RTC stays open, but this one relay cannot process the arriving
    // message. No send/forward/ACK function is mocked or replaced.
    const cdp=await contexts[failedIndex]!.newCDPSession(pages[failedIndex]!);
    await cdp.send("Debugger.enable");
    const paused=new Promise<void>((resolve) => cdp.once("Debugger.paused",() => resolve()));
    await cdp.send("Debugger.pause"); await paused;
    await host.getByRole("button",{ name:"Send",exact:true }).click();
    await expect(host.getByLabel("Conversation history")).toContainText("Awaiting receiver receipt");
    const sentBeforeClose=Date.now();
    await contexts[failedIndex]!.close();
    const closedAt=Date.now();
    await expect(receiver.getByLabel("Conversation history").getByText(body,{ exact:true })).toBeVisible({ timeout:20_000 });
    await expect(host.getByLabel("Conversation history").getByText(/You.*delivered/)).toBeVisible();
    await expect(receiver.getByLabel("Conversation history").getByText(body,{ exact:true })).toHaveCount(1);
    await host.screenshot({ path:path.resolve("docs/screenshots/hopnet-message-recovered.png"),animations:"disabled" });
    await host.getByRole("button",{ name:"Open replay view" }).click();
    const journal=await downloadJson(host,"Export journal") as { events:RecordedEvent[] };
    const forwards=journal.events.filter((event) => event.type==="packet-forward");
    expect(forwards[0]?.path).toEqual([source.id,failedHop]);
    expect(forwards.some((event) => event.path?.[1]!==failedHop)).toBe(true);
    expect(journal.events.filter((event) => event.type==="message-retry").length).toBeGreaterThan(0);
    expect(journal.events.filter((event) => event.type==="delivery-ack")).toHaveLength(1);
    expect(errors).toEqual([]);
    const proof=JSON.stringify({ provenance:"AUTOMATED CHROME WEBRTC — NOT PHYSICAL DEVICES", fault:"CDP pauses relay JavaScript, sender actually sends into its open RTC channel, then that browser context is closed",sentBeforeClose,closedAt,failedHop,before,journal,runtimeErrors:errors },null,2);
    await mkdir(path.resolve("docs/evidence"),{ recursive:true });
    await writeFile(path.resolve("docs/evidence/message-midflight-recovery.json"),proof);
    await testInfo.attach("message-midflight-recovery.json",{ body:proof,contentType:"application/json" });
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});
