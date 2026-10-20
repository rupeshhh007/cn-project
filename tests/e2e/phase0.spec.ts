import path from "node:path";
import { expect, test } from "@playwright/test";

const screenshotPath = (name: string) => path.resolve("docs/screenshots", name);

test("host admits a participant and exchanges data over WebRTC", async ({ browser }) => {
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const host = await hostContext.newPage();
  await host.goto("/");
  await host.getByLabel("Device name").fill("Host Mac");
  await host.getByRole("button", { name: "Create private room" }).click();
  await expect(host.getByText("Your room is ready.")).toBeVisible();
  await host.screenshot({ path: screenshotPath("hopnet-phase0-entry-desktop.png"), mask: [host.getByRole("img", { name: "QR code to join this HOPNET room" })] });

  const qrSource = await host.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
  expect(qrSource).toBeTruthy();
  const advertisedOrigin = new URL(qrSource!, "http://127.0.0.1:4173").searchParams.get("origin");
  expect(advertisedOrigin).toBeTruthy();
  expect(["localhost", "127.0.0.1"]).not.toContain(new URL(advertisedOrigin!).hostname);
  const parsed = qrSource!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/);
  expect(parsed).toBeTruthy();

  const participantContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const participant = await participantContext.newPage();
  await participant.goto(`/?room=${encodeURIComponent(parsed![1])}&invite=${encodeURIComponent(parsed![2])}`);
  await participant.getByLabel("Device name").fill("Phone Test");
  await participant.getByLabel("Device type").selectOption("phone");
  await participant.getByRole("button", { name: "Request to join" }).click();
  await expect(participant.getByRole("button", { name: "Waiting for host approval…" })).toBeDisabled();

  await expect(host.getByText("Phone Test")).toBeVisible();
  await host.getByRole("button", { name: "Admit" }).click();
  await participant.getByRole("button", { name: "Room", exact: true }).click();
  await expect(participant.getByText("You’re part of the route.")).toBeVisible();
  await participant.getByRole("button", { name: "Messages", exact: true }).click();
  await expect(participant.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await participant.getByRole("button", { name: "Ping over WebRTC" }).click();
  await expect(participant.getByText(/ms$/)).toBeVisible();
  await participant.screenshot({ path: screenshotPath("hopnet-phase0-mobile-participant.png") });
  await participant.getByPlaceholder("Message this peer…").fill("hello over the real data channel");
  await participant.getByRole("button", { name: "Send", exact: true }).click();
  await expect(host.getByText("hello over the real data channel")).toBeAttached();
  await participant.getByRole("button", { name: "Activity", exact: true }).click();
  await expect(participant.getByText("Message acknowledged")).toBeAttached();
  await host.screenshot({ path: screenshotPath("hopnet-phase0-live-desktop.png") });

  await participantContext.close();
  await hostContext.close();
});

test("routes a message through a real intermediate browser without an endpoint channel", async ({ browser }) => {
  test.setTimeout(60_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  await host.goto("/");
  await host.getByLabel("Device name").fill("Relay Mac");
  await host.getByRole("button", { name: "Create private room" }).click();
  await expect(host.getByText("Your room is ready.")).toBeVisible();

  const qrSource = await host.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
  const parsed = qrSource!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/)!;
  const joinUrl = `/?room=${encodeURIComponent(parsed[1])}&invite=${encodeURIComponent(parsed[2])}`;

  const phoneA = await context.newPage();
  await phoneA.goto(joinUrl);
  await phoneA.getByLabel("Device name").fill("Phone A");
  await phoneA.getByLabel("Device type").selectOption("phone");
  await phoneA.getByRole("button", { name: "Request to join" }).click();
  await expect(host.getByText("Phone A")).toBeVisible();
  await host.getByRole("button", { name: "Admit" }).click();
  await expect(phoneA.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  const phoneB = await context.newPage();
  await phoneB.goto(joinUrl);
  await phoneB.getByLabel("Device name").fill("Phone B");
  await phoneB.getByLabel("Device type").selectOption("phone");
  await phoneB.getByRole("button", { name: "Request to join" }).click();
  await expect(host.getByText("Phone B")).toBeVisible();
  await host.getByRole("button", { name: "Admit" }).click();
  await expect(phoneB.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await phoneA.getByRole("button", { name: /Phone B/ }).click();
  await expect(phoneA.getByText("2-hop overlay", { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(phoneA.getByText("Established overlay links", { exact: true })).toBeVisible();
  await phoneA.getByPlaceholder("Message this peer…").fill("forward this through the relay");
  await phoneA.getByRole("button", { name: "Send", exact: true }).click();

  await expect(phoneB.getByText("Routed message delivered")).toBeAttached({ timeout: 10_000 });
  await expect(phoneB.getByText(/forward this through the relay/)).toBeAttached();
  await expect(host.getByText("Payload forwarded").first()).toBeAttached();
  await expect(phoneA.getByText("Route receipt returned")).toBeAttached();
  await phoneA.getByLabel("Choose file to send").setInputFiles({ name: "relay-proof.bin", mimeType: "application/octet-stream", buffer: Buffer.from("verified through the intermediate browser") });
  await expect(phoneB.getByRole("button", { name: "Accept relay-proof.bin" })).toBeVisible();
  await phoneB.getByRole("button", { name: "Accept relay-proof.bin" }).click();
  await expect(phoneA.getByText("File integrity verified")).toBeAttached({ timeout: 15_000 });
  await expect(host.getByText("Transfer packet forwarded").first()).toBeAttached();
  await expect(phoneB.getByText("SHA-256 verified")).toBeVisible();
  await expect(phoneA.getByText("SHA-256 verified")).toBeVisible();
  await phoneA.evaluate(() => window.scrollTo(0, 0));
  await phoneA.screenshot({ path: screenshotPath("hopnet-phase2-multihop-proof.png") });

  await context.close();
});
test("sends a consented file over a direct WebRTC data channel and verifies its digest", async ({ browser }) => {
  test.setTimeout(45_000);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
  const host = await context.newPage();
  await host.goto("/");
  await host.getByLabel("Device name").fill("File Sender");
  await host.getByRole("button", { name: "Create private room" }).click();
  const qrSource = await host.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
  const parsed = qrSource!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/)!;
  const participant = await context.newPage();
  await participant.goto(`/?room=${encodeURIComponent(parsed[1])}&invite=${encodeURIComponent(parsed[2])}`);
  await participant.getByLabel("Device name").fill("File Receiver");
  await participant.getByLabel("Device type").selectOption("phone");
  await participant.getByRole("button", { name: "Request to join" }).click();
  await expect(host.getByText("File Receiver")).toBeVisible();
  await host.getByRole("button", { name: "Admit" }).click();
  await expect(host.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

  await host.getByLabel("Choose file to send").setInputFiles({ name: "proof.txt", mimeType: "text/plain", buffer: Buffer.from("integrity checked through the application data channel") });
  await expect(participant.getByText("Incoming file offer")).toBeAttached();
  await participant.getByRole("button", { name: "Accept proof.txt" }).click();
  await expect(host.getByText("File integrity verified")).toBeAttached({ timeout: 15_000 });
  await expect(participant.getByText("SHA-256 verified")).toBeVisible();
  await expect(participant.getByRole("link", { name: "Save file" })).toHaveAttribute("download", "proof.txt");
  await context.close();
});
