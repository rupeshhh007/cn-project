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
  await host.screenshot({ path: screenshotPath("hopnet-phase0-entry-desktop.png") });

  const qrSource = await host.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
  expect(qrSource).toBeTruthy();
  const parsed = qrSource!.match(/\/rooms\/([^/]+)\/qr\?invite=(.+)$/);
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
  await expect(participant.getByText("You’re part of the route.")).toBeVisible();
  await expect(participant.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await participant.getByRole("button", { name: "Ping over WebRTC" }).click();
  await expect(participant.getByText(/ms$/)).toBeVisible();
  await participant.screenshot({ path: screenshotPath("hopnet-phase0-mobile-participant.png") });
  await participant.getByPlaceholder("Message this peer…").fill("hello over the real data channel");
  await participant.getByRole("button", { name: "Send", exact: true }).click();
  await expect(host.getByText("hello over the real data channel")).toBeAttached();
  await expect(participant.getByText("Message acknowledged")).toBeAttached();
  await host.screenshot({ path: screenshotPath("hopnet-phase0-live-desktop.png") });

  await participantContext.close();
  await hostContext.close();
});

test("routes a message through a real intermediate browser without an endpoint channel", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const host = await context.newPage();
  await host.goto("/");
  await host.getByLabel("Device name").fill("Relay Mac");
  await host.getByRole("button", { name: "Create private room" }).click();
  await expect(host.getByText("Your room is ready.")).toBeVisible();

  const qrSource = await host.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
  const parsed = qrSource!.match(/\/rooms\/([^/]+)\/qr\?invite=(.+)$/)!;
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
  await expect(phoneA.getByText("not selected", { exact: true })).toBeVisible();
  await phoneA.getByPlaceholder("Message this peer…").fill("forward this through the relay");
  await phoneA.getByRole("button", { name: "Send", exact: true }).click();

  await expect(phoneB.getByText("Routed message delivered")).toBeAttached({ timeout: 10_000 });
  await expect(phoneB.getByText(/forward this through the relay/)).toBeAttached();
  await expect(host.getByText("Payload forwarded").first()).toBeAttached();
  await expect(phoneA.getByText("Route receipt returned")).toBeAttached();
  await phoneA.evaluate(() => window.scrollTo(0, 0));
  await phoneA.screenshot({ path: screenshotPath("hopnet-phase2-multihop-proof.png") });

  await context.close();
});
