import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.use({ trace: "off" });

const evidence = async (page: Page) => JSON.parse(await page.getByTestId("transfer-send").getByTestId("transfer-evidence").textContent() ?? "{}");

test("two real relay routes survive a mid-transfer browser failure with receiver SHA-256", async ({ browser }, testInfo) => {
  // Setup includes distributed topology learning; the verified-recovery
  // assertion below remains independently bounded at 60 seconds.
  test.setTimeout(120_000);
  const contexts = await Promise.all([0, 1, 2, 3].map(() => browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })));
  try {
    const [host, relay1, relay2, receiver] = await Promise.all(contexts.map((context) => context.newPage()));
    await host.goto("/");
    await host.getByLabel("Device name").fill("Sender");
    await host.getByRole("button", { name: "Create private room" }).click();
    const qr = await host.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
    const parsed = qr!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/)!;
    for (const [page, name] of [[relay1, "Relay One"], [relay2, "Relay Two"], [receiver, "Receiver"]] as const) {
      await page.goto(`/?room=${parsed[1]}&invite=${parsed[2]}`);
      await page.getByLabel("Device name").fill(name);
      await page.getByRole("button", { name: "Request to join" }).click();
      await host.getByRole("button", { name: "Admit", exact: true }).click();
      await expect(page.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    }
    await host.getByRole("button", { name: "Open lab view" }).click();
    await host.getByLabel("Experiment receiver").selectOption({ label:"Receiver" });
    const edge = (a: string, b: string) => host.getByRole("button", { name: new RegExp(`^(${a} ↔ ${b}|${b} ↔ ${a})`) });
    await edge("Sender", "Receiver").click();
    await edge("Relay One", "Receiver").click();
    await edge("Relay Two", "Receiver").click();
    await expect(host.getByLabel("Available experiment routes").getByText("2 established routes", { exact:true })).toBeVisible({ timeout:15_000 });
    await host.getByRole("button", { name: "Open space view" }).click();
    await host.getByRole("button", { name: /^Receiver,/ }).click();
    await expect(host.getByText("2-hop overlay", { exact: true })).toBeVisible({ timeout: 15_000 });
    const payload = Buffer.alloc(8 * 1024 * 1024);
    for (let index = 0; index < payload.length; index += 1) payload[index] = (index * 31 + (index >>> 8)) & 255;
    const expectedHash = createHash("sha256").update(payload).digest("hex");
    await host.getByLabel("Choose file to send").setInputFiles({ name: "resilience-proof.bin", mimeType: "application/octet-stream", buffer: payload });
    await receiver.getByRole("button", { name: "Accept resilience-proof.bin" }).click();
    await expect.poll(async () => (await evidence(host)).pathStats?.filter((item: { acknowledgedChunks: number }) => item.acknowledgedChunks > 0).length, { timeout:15_000 }).toBe(2);
    const before = await evidence(host);
    await testInfo.attach("before-relay-close.json", { body:JSON.stringify(before,null,2),contentType:"application/json" });
    expect(before.acknowledgedChunks).toBeLessThan(before.totalChunks);
    // Close an actual browser participating in the data plane. No coordinator
    // fallback, fake RTC implementation, or synthesized completion is involved.
    await contexts[1]!.close();
    await host.screenshot({ path: path.resolve("docs/screenshots/hopnet-resilience-active.png") });
    try {
      await expect(host.getByTestId("transfer-send")).toHaveAttribute("data-status", "verified", { timeout: 60_000 });
    } catch (cause) {
      await testInfo.attach("unverified-recovery-state.json", { body:JSON.stringify(await evidence(host),null,2),contentType:"application/json" });
      throw cause;
    }
    const after = await evidence(host);
    expect(after.verifiedHash).toBe(expectedHash);
    expect(after.acknowledgedBytes).toBe(payload.length);
    expect(after.history.some((event: { type: string }) => event.type === "path-unavailable")).toBe(true);
    expect(after.pathStats.some((item: { failures: number }) => item.failures > 0)).toBe(true);
    expect(after.pathStats.reduce((sum: number, item: { attemptedChunks: number }) => sum + item.attemptedChunks, 0)).toBeLessThan(after.totalChunks * 2);
    const downloadPromise = receiver.waitForEvent("download");
    await receiver.getByRole("link", { name: "Save file" }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const digest = createHash("sha256");
    for await (const chunk of stream!) digest.update(chunk);
    expect(digest.digest("hex")).toBe(expectedHash);
    const proof = JSON.stringify({ provenance: "AUTOMATED BROWSER EXPERIMENT", failure: "Actual relay browser context closed", beforeFailure: before, completed: after, downloadedSha256: expectedHash }, null, 2);
    await testInfo.attach("actual-transfer-evidence.json", { body: proof, contentType: "application/json" });
    await mkdir(path.resolve("docs/evidence"), { recursive: true });
    await writeFile(path.resolve("docs/evidence/automated-relay-recovery.json"), proof);
    await host.screenshot({ path: path.resolve("docs/screenshots/hopnet-resilience-recovered.png") });
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});
