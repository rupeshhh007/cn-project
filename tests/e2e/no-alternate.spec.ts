import path from "node:path";
import { expect, test } from "@playwright/test";

test.use({ trace: "off" });

test("loss of the only relay ends with an honest bounded failure and actionable UI", async ({ browser }) => {
  // Keep the production failure assertion at 65 seconds below. The overall
  // harness additionally needs room creation, RTC admission, capture and cleanup.
  test.setTimeout(120_000);
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 1440, height: 900 } })));
  try {
    const [sender, relay, receiver] = await Promise.all(contexts.map((context) => context.newPage()));
    await sender.goto("/"); await sender.getByLabel("Device name").fill("Failure Sender");
    await sender.getByRole("button", { name: "Create private room" }).click();
    const qr = await sender.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
    const invitation = qr!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/)!;
    for (const [page, name] of [[relay, "Only Relay"], [receiver, "Failure Receiver"]] as const) {
      await page.goto(`/?room=${invitation[1]}&invite=${invitation[2]}`);
      await page.getByLabel("Device name").fill(name);
      await page.getByRole("button", { name: "Request to join" }).click();
      await sender.getByRole("button", { name: "Admit", exact: true }).click();
      await expect(page.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    }
    await sender.getByRole("button", { name: "Open lab view" }).click();
    await sender.getByRole("button", { name: /^Failure Sender ↔ Failure Receiver/ }).click();
    await sender.getByRole("button", { name: /^(Only Relay ↔ Failure Receiver|Failure Receiver ↔ Only Relay)/ }).click();
    await sender.getByRole("button", { name: "Open space view" }).click();
    await sender.getByRole("button", { name: /^Failure Receiver,/ }).click();
    await expect(sender.getByText("2-hop overlay", { exact: true })).toBeVisible({ timeout: 15_000 });
    await sender.getByLabel("Choose file to send").setInputFiles({ name: "unavailable.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(4 * 1024 * 1024, 42) });
    await receiver.getByRole("button", { name: "Accept unavailable.bin" }).click();
    await expect.poll(async () => JSON.parse(await sender.getByTestId("transfer-evidence").textContent() ?? "{}").acknowledgedChunks).toBeGreaterThan(0);
    await contexts[1]!.close();
    await test.step("production no-progress deadline remains bounded", async () => {
      await expect(sender.getByTestId("transfer-send")).toHaveAttribute("data-status", "failed", { timeout: 65_000 });
    });
    await expect(sender.getByText(/No receiver progress for 60 seconds/).first()).toBeAttached();
    await sender.getByRole("button", { name: "Open send view" }).click();
    await expect(sender.getByTestId("transfer-send")).toBeVisible();
    await expect(sender.getByTestId("transfer-send")).toHaveCSS("opacity", "1");
    await test.step("capture actionable failure", async () => {
      await sender.screenshot({ path: path.resolve("docs/screenshots/hopnet-no-alternate-failure.png"), animations: "disabled" });
    });
  } finally { await test.step("close test browser contexts", () => Promise.all(contexts.map((context) => context.close()))); }
});
