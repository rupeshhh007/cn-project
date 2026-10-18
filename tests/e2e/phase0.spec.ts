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
