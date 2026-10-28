import { createHash } from "node:crypto";
import { expect,test } from "@playwright/test";

test.use({trace:"off"});
test("live public HTTPS serves the app, authenticated signaling, WebRTC, signed files and Route Pulse",async ({browser,request})=>{
  test.skip(!process.env.HOPNET_TEST_URL,"Explicit public deployment URL required; this is not a localhost deployment claim.");
  test.setTimeout(90_000);
  const origin=new URL(process.env.HOPNET_TEST_URL!).origin;
  expect(origin).toMatch(/^https:/);
  expect((await request.get("/api/health")).status()).toBe(200);
  const info=await (await request.get("/api/network")).json();
  expect(info.mode).toBe("hosted");expect(info.secure).toBe(true);expect(info.preferredOrigin).toBe(origin);expect(info.interfaces).toEqual([]);
  const contexts=await Promise.all([browser.newContext({viewport:{width:1440,height:900},acceptDownloads:true}),browser.newContext({viewport:{width:390,height:844},acceptDownloads:true})]);
  const errors:string[]=[];
  try {
    const [host,phone]=await Promise.all(contexts.map((context)=>context.newPage()));
    for(const page of [host,phone]) {page.on("pageerror",(error)=>errors.push(error.message));page.on("console",(message)=>{if(message.type()==="error") errors.push(message.text());});}
    await host.goto(origin);await expect(host).toHaveTitle(/HOPNET/);
    expect(await host.evaluate(()=>isSecureContext)).toBe(true);
    await host.getByLabel("Device name").fill("Hosted source");await host.getByRole("button",{name:"Create private room"}).click();
    const src=await host.getByRole("img",{name:"QR code to join this HOPNET room"}).getAttribute("src");
    const url=new URL(src!,origin);expect(url.searchParams.get("origin")).toBe(origin);
    const room=url.pathname.match(/\/rooms\/([^/]+)\/qr/)![1];
    await phone.goto(`${origin}/?room=${encodeURIComponent(room)}&invite=${encodeURIComponent(url.searchParams.get("invite")!)}`);
    await phone.getByLabel("Device name").fill("Hosted phone viewport");await phone.getByLabel("Device type").selectOption("phone");
    await phone.getByRole("button",{name:"Request to join"}).click();await host.getByRole("button",{name:"Admit",exact:true}).click();
    await expect(phone.getByText("Direct WebRTC",{exact:true}).first()).toBeVisible({timeout:20000});
    await phone.getByPlaceholder("Message this peer…").fill("Public HTTPS signaling, real peer data");await phone.getByRole("button",{name:"Send",exact:true}).click();
    await expect(host.getByText("Public HTTPS signaling, real peer data")).toBeAttached();
    const payload=Buffer.from("Actual downloaded file from the deployed HOPNET coordinator's peer session.\n".repeat(256));
    await host.getByLabel("Choose file to send").setInputFiles({name:"hosted-proof.txt",mimeType:"text/plain",buffer:payload});
    await phone.getByRole("button",{name:"Accept hosted-proof.txt"}).click();
    await expect(host.getByTestId("transfer-send")).toHaveAttribute("data-status","verified",{timeout:20000});
    const waiting=phone.waitForEvent("download");await phone.getByRole("link",{name:"Save file"}).click();
    const stream=await (await waiting).createReadStream(),digest=createHash("sha256");for await(const chunk of stream!) digest.update(chunk);
    expect(digest.digest("hex")).toBe(createHash("sha256").update(payload).digest("hex"));
    await host.getByRole("button",{name:"Open routing view"}).click();
    await host.getByRole("button",{name:"Send route pulse",exact:true}).click();
    const pulse=host.getByRole("region",{name:"Route Pulse",exact:true});await expect(pulse.getByText("Receipt returned",{exact:true})).toBeVisible();
    await expect(pulse.getByRole("list",{name:"Receiver-reported outward route"}).locator("li")).toHaveCount(2);
    await host.locator(".routing-workspace img").evaluateAll(async (images)=>{await Promise.all(images.map((image)=>(image as HTMLImageElement).decode()));});
    await pulse.scrollIntoViewIfNeeded();await host.screenshot({path:"/tmp/hopnet-hosted-desktop.png",animations:"disabled"});
    await phone.getByRole("button",{name:"Routing",exact:true}).click();await phone.getByRole("button",{name:"Send route pulse",exact:true}).click();
    await expect(phone.getByRole("region",{name:"Route Pulse",exact:true}).getByText("Receipt returned",{exact:true})).toBeVisible();
    await phone.locator(".routing-workspace img").evaluateAll(async (images)=>{await Promise.all(images.map((image)=>(image as HTMLImageElement).decode()));});
    await phone.screenshot({path:"/tmp/hopnet-hosted-mobile.png",animations:"disabled"});
    expect(errors).toEqual([]);
  } finally {await Promise.all(contexts.map((context)=>context.close()));}
});
