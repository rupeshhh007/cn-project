import path from "node:path";
import { expect,test,type Page } from "@playwright/test";
import WebSocket from "ws";
import { writeFile } from "node:fs/promises";

test.use({trace:"off"});
const screen=(name:string)=>path.resolve("docs/screenshots",`hopnet-recovery-${name}.png`);
const stored=(page:Page)=>page.evaluate(()=>JSON.parse(sessionStorage.getItem("hopnet.tab-session.v1")!));
async function hostRoom(page:Page) {
  await page.goto("/");await page.getByLabel("Device name").fill("Source");await page.getByRole("button",{name:"Create private room"}).click();
  const qr=await page.getByRole("img",{name:"QR code to join this HOPNET room"}).getAttribute("src");
  const parsed=qr!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/)!;
  return `/?room=${parsed[1]}&invite=${parsed[2]}`;
}
async function request(page:Page,url:string,name:string) {
  await page.goto(url);await page.getByLabel("Device name").fill(name);await page.getByLabel("Device type").selectOption(/Phone|Android/.test(name) ? "phone":"laptop");await page.getByRole("button",{name:"Request to join"}).click();
}
async function admit(host:Page,page:Page,url:string,name:string) {
  await request(page,url,name);await host.getByRole("button",{name:"Admit",exact:true}).click();
  await expect(page.getByText("Direct WebRTC",{exact:true}).first()).toBeVisible({timeout:15000});
}

test("host reload recovers missed admission; mobile reload preserves identity and renegotiates actual RTC",async ({browser})=>{
  test.setTimeout(60_000);
  const hc=await browser.newContext({viewport:{width:1440,height:900}}),pc=await browser.newContext({viewport:{width:390,height:844}});
  try {
    const host=await hc.newPage(),phone=await pc.newPage();const url=await hostRoom(host);const before=await stored(host);
    await host.screenshot({path:screen("desktop-before"),mask:[host.getByRole("img",{name:"QR code to join this HOPNET room"})]});
    await request(phone,url,"Android Relay");
    await phone.reload();await expect(phone.getByRole("button",{name:"Waiting for host approval…"})).toBeDisabled();
    await host.reload();await expect(host.getByText("Session restored.",{exact:false})).toBeVisible();
    expect((await stored(host)).peerId).toBe(before.peerId);
    await expect(host.locator(".admission").getByText("Android Relay")).toBeVisible();
    await host.route("**/approve",(route)=>route.abort(),{times:1});
    await host.getByRole("button",{name:"Admit",exact:true}).click();
    await expect(host.getByText(/Admission could not reach the coordinator/)).toBeVisible();
    await host.getByRole("button",{name:"Admit",exact:true}).click();
    await expect(host.locator(".admission")).toHaveCount(0);
    await expect(phone.getByText("Direct WebRTC",{exact:true}).first()).toBeVisible({timeout:15000});
    const phoneId=(await stored(phone)).peerId;
    await phone.reload();await expect(phone.getByText("Direct WebRTC",{exact:true}).first()).toBeVisible({timeout:15000});
    expect((await stored(phone)).peerId).toBe(phoneId);
    await phone.getByPlaceholder("Message this peer…").fill("after genuine relay reload");await phone.getByRole("button",{name:"Send",exact:true}).click();
    await expect(host.getByText("after genuine relay reload")).toBeAttached();
    await host.getByRole("button",{name:"Room invitation",exact:true}).click();
    await expect(host.getByRole("button",{name:"Copy invitation"})).toBeVisible();
    // The same host controls must remain usable at phone width after admission.
    await host.setViewportSize({width:390,height:844});await host.getByRole("button",{name:"Room invitation",exact:true}).click();
    await expect(host.getByRole("button",{name:"Copy invitation"})).toBeVisible();
    await expect(host.getByLabel("Invitation address")).toBeVisible();
    await host.getByRole("button",{name:"Copy invitation"}).click();
    await expect(host.locator(".mobile-room-invite").getByRole("status")).toContainText(/Invitation copied|Clipboard unavailable/);
    await host.screenshot({path:screen("mobile-invitation"),mask:[host.getByRole("img",{name:"QR code to join this HOPNET room"})],fullPage:true});
    const rejected=await pc.newPage();await request(rejected,url,"Declined device");
    await host.getByRole("button",{name:"Reject",exact:true}).click();await expect(rejected.getByText(/host declined/)).toBeVisible();
    await host.getByRole("button",{name:"Routing",exact:true}).click();
    await expect(host.getByRole("table",{name:"Local forwarding table"})).toBeVisible();
    await host.screenshot({path:screen("routing-mobile"),fullPage:true});
    expect(await host.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await host.setViewportSize({width:1440,height:900});await host.getByRole("button",{name:"Open routing view"}).click();
    await expect(host.locator(".primary-nav button.active")).toHaveAttribute("aria-label","Open routing view");
    await expect(host.getByRole("heading",{name:"Every peer, a router."})).toBeVisible();
    await expect(host.getByRole("table",{name:"Local forwarding table"})).toBeVisible();
    await host.evaluate(()=>new Promise<void>((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await host.screenshot({path:screen("routing-desktop"),animations:"disabled"});
    const exported=host.waitForEvent("download");await host.getByRole("button",{name:"Export router evidence"}).click();
    const stream=await (await exported).createReadStream();const chunks:Buffer[]=[];
    for await(const chunk of stream!) chunks.push(Buffer.from(chunk));
    const evidence=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(evidence.snapshots.find((snapshot:{id:string})=>snapshot.id===before.peerId).lsdb.find((row:{origin:string})=>row.origin===before.peerId).generation).toBeGreaterThan(0);
    await writeFile(path.resolve("docs/evidence/session-recovery-router.json"),JSON.stringify(evidence,null,2));
    // Invalid capability must never be accepted as a restored identity.
    await rejected.evaluate(()=>{sessionStorage.setItem("hopnet.tab-session.v1",JSON.stringify({version:1,roomId:"room_missing123",peerId:"peer_missing123",sessionToken:"x".repeat(32)}));});
    await rejected.goto("/");await expect(rejected.getByText(/Session expired:/)).toBeVisible();
    await expect(rejected.getByRole("button",{name:"Create private room"})).toBeVisible();
    const clone=await hc.newPage();
    await clone.addInitScript((session)=>sessionStorage.setItem("hopnet.tab-session.v1",JSON.stringify(session)),await stored(host));
    await clone.goto("/");await expect(clone.getByText(/This session is already open in another tab/)).toBeVisible();
    expect((await stored(host)).peerId).toBe(before.peerId);
  } finally {await hc.close();await pc.close();}
});

test("signaling outage preserves live RTC; endpoint refresh during active file fails honestly",async ({browser})=>{
  test.setTimeout(60_000);
  const hc=await browser.newContext({viewport:{width:1440,height:900}}),pc=await browser.newContext({viewport:{width:390,height:844}});
  try {
    const host=await hc.newPage(),phone=await pc.newPage();const url=await hostRoom(host);await admit(host,phone,url,"Phone");
    await expect(phone.getByText(/Hello neighbor active/)).toBeVisible({timeout:15000});
    // An actual authenticated transport replacement closes only the browser's
    // signaling socket. No page APIs or RTC send/receive code are mocked.
    const session=await stored(phone);
    const replacement=new WebSocket(`ws://127.0.0.1:4173/signal?token=${encodeURIComponent(session.sessionToken)}`);
    await new Promise<void>((resolve,reject)=>{replacement.once("open",resolve);replacement.once("error",reject);});
    const closed=new Promise<void>((resolve)=>replacement.once("close",()=>resolve()));replacement.close();await closed;
    await expect(host.getByText("Signaling disconnected",{exact:true})).toBeVisible();
    await expect(host.getByText("Direct WebRTC",{exact:true}).first()).toBeVisible();
    await phone.getByPlaceholder("Message this peer…").fill("RTC survives signaling loss");await phone.getByRole("button",{name:"Send",exact:true}).click();
    await expect(host.getByText("RTC survives signaling loss")).toBeAttached();
    await phone.reload();await expect(phone.getByText("Direct WebRTC",{exact:true}).first()).toBeVisible({timeout:15000});
    await expect(phone.locator(".mobile-status").getByText("Coordinator connected")).toBeVisible();
    await host.getByLabel("Choose file to send").setInputFiles({name:"refresh-interruption.bin",mimeType:"application/octet-stream",buffer:Buffer.alloc(8*1024*1024,79)});
    await phone.getByRole("button",{name:"Accept refresh-interruption.bin"}).click();
    await expect.poll(async ()=>JSON.parse(await host.getByTestId("transfer-send").getByTestId("transfer-evidence").textContent() ?? "{}").acknowledgedChunks,{timeout:15000}).toBeGreaterThan(0);
    await phone.reload();
    await expect(host.getByTestId("transfer-send")).toHaveAttribute("data-status","failed",{timeout:15000});
    await expect(host.locator("span").filter({hasText:/^Peer refreshed or restarted/})).toBeVisible();
    await expect(phone.getByText("Direct WebRTC",{exact:true}).first()).toBeVisible({timeout:15000});
    await expect(phone.getByRole("link",{name:"Save file"})).toHaveCount(0);
    await host.getByLabel("Choose file to send").setInputFiles({name:"fresh-after-reload.txt",mimeType:"text/plain",buffer:Buffer.from("fresh signing identity after reload")});
    await phone.getByRole("button",{name:"Accept fresh-after-reload.txt"}).click();
    await expect(host.getByTestId("transfer-send").filter({hasText:"fresh-after-reload.txt"})).toHaveAttribute("data-status","verified",{timeout:15000});
  } finally {await hc.close();await pc.close();}
});

test("diamond relay reload and repeated logical fault/restore converge without re-admission",async ({browser})=>{
  test.setTimeout(90_000);
  const contexts=await Promise.all([0,1,2,3].map(()=>browser.newContext({viewport:{width:1440,height:900}})));
  try {
    const [host,r1,r2,dest]=await Promise.all(contexts.map((c)=>c.newPage()));const url=await hostRoom(host);
    await admit(host,r1,url,"Relay One");await admit(host,r2,url,"Relay Two");await admit(host,dest,url,"Destination");
    await host.getByRole("button",{name:"Open lab view"}).click();await host.getByLabel("Experiment receiver").selectOption({label:"Destination"});
    const edge=(a:string,b:string)=>host.getByRole("button",{name:new RegExp(`^(${a} ↔ ${b}|${b} ↔ ${a})`)});
    await edge("Source","Destination").click();await edge("Relay One","Destination").click();await edge("Relay Two","Destination").click();
    const routes=host.getByLabel("Available experiment routes");await expect(routes.getByText("2 established routes",{exact:true})).toBeVisible({timeout:15000});
    const id=(await stored(r1)).peerId;await r1.reload();await expect(routes.getByText("2 established routes",{exact:true})).toBeVisible({timeout:20000});expect((await stored(r1)).peerId).toBe(id);
    for(let attempt=0;attempt<2;attempt++) {
      await host.getByLabel("Failure relay").selectOption({label:"Relay One"});
      await host.getByRole("button",{name:"Disconnect relay links",exact:true}).click();await expect(routes.getByText("1 established route",{exact:true})).toBeVisible({timeout:15000});
      await host.getByRole("button",{name:"Open send view"}).click();await host.locator(".conversation-peers").getByRole("button",{name:/Destination/}).click();
      await host.getByPlaceholder("Message this peer…").fill(`surviving route ${attempt}`);await host.getByRole("button",{name:"Send",exact:true}).click();
      await expect(host.getByLabel("Conversation history").locator("article").filter({hasText:`surviving route ${attempt}`})).toContainText("delivered");
      await host.getByRole("button",{name:"Open lab view"}).click();await host.getByLabel("Failure relay").selectOption({label:"Relay One"});await host.getByRole("button",{name:"Restore relay links",exact:true}).click();
      await expect(routes.getByText("2 established routes",{exact:true})).toBeVisible({timeout:15000});
    }
  } finally {await Promise.all(contexts.map((c)=>c.close()));}
});

test("storage-denial fallback allows room creation and warns without crashing",async ({browser})=>{
  test.setTimeout(30_000);
  const context=await browser.newContext({viewport:{width:1440,height:900}});
  try {
    const page=await context.newPage();
    await page.addInitScript(()=>{
      Object.defineProperty(window,"sessionStorage",{
        configurable:true,
        get(){throw new DOMException("The operation is insecure.","SecurityError");},
      });
    });
    await page.goto("/");
    await page.getByLabel("Device name").fill("Source");
    await page.getByRole("button",{name:"Create private room"}).click();
    await expect(page.getByText("Tab storage is unavailable; reloading will require admission again.")).toBeVisible({timeout:10000});
    await expect(page.getByText("Your room is ready.")).toBeVisible({timeout:10000});
  } finally {await context.close();}
});
