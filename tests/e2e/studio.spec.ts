import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

test.use({ trace: "off" });
const screenshots = path.resolve("docs/screenshots/studio");
const sizes = [[1920, 1080], [1586, 992], [1440, 900], [1280, 720], [768, 1024], [430, 932], [390, 844]];

async function layout(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const obstructions = await page.locator("button:visible,input:not([type=file]):visible,select:visible").evaluateAll((controls) => controls.flatMap((control) => {
    if ((control as HTMLButtonElement).disabled) return [];
    const rect = control.getBoundingClientRect();
    // Scrollable content is allowed offscreen. Check controls in the usable viewport.
    if (rect.width < 5 || rect.height < 5 || rect.top < 0 || rect.bottom > innerHeight || rect.left < 0 || rect.right > innerWidth) return [];
    for (let ancestor = control.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflowY}`)) {
        const clip = ancestor.getBoundingClientRect();
        if (rect.top + rect.height / 2 < clip.top || rect.top + rect.height / 2 > clip.bottom || rect.left + rect.width / 2 < clip.left || rect.left + rect.width / 2 > clip.right) return [];
      }
    }
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit && !control.contains(hit) && !hit.contains(control) ? [{ control: control.getAttribute("aria-label") ?? control.textContent?.slice(0, 70), hit: `${hit.tagName}.${hit.className}`, width: innerWidth, height: innerHeight }] : [];
  }));
  if (obstructions.length) await page.screenshot({ path: `/tmp/hopnet-obstruction-${page.viewportSize()?.width}.png`, animations: "disabled" });
  expect(obstructions).toEqual([]);
  expect(await page.locator(".device-render img").evaluateAll((images) => images.every((image) => {
    const frame = image.parentElement!.getBoundingClientRect(), bounds = image.getBoundingClientRect();
    return bounds.width <= frame.width + 1 && bounds.height <= frame.height + 1;
  }))).toBe(true);
  // Live endpoints must terminate on a plinth, including after responsive resize.
  await expect.poll(() => page.locator(".network-lines path").evaluateAll((paths) => {
    const pads = [...document.querySelectorAll(".plinth")].map((pad) => pad.getBoundingClientRect());
    return paths.every((node) => {
      const path = node as SVGPathElement;
      return [0, path.getTotalLength()].every((length) => {
        const point = path.getPointAtLength(length).matrixTransform(path.getScreenCTM()!);
        return pads.some((pad) => point.x >= pad.left - 3 && point.x <= pad.right + 3 && point.y >= pad.top - 3 && point.y <= pad.bottom + 3);
      });
    });
  })).toBe(true);
  // Recorded percent positions and SVG endpoints must share the same coordinate
  // space, rather than letterboxing a square viewBox in a rectangular panel.
  expect(await page.locator(".historical-network line").evaluateAll((lines) => {
    const peers = [...document.querySelectorAll(".historical-peer")].map((peer) => peer.getBoundingClientRect());
    return lines.every((node) => {
      const line = node as SVGLineElement;
      return [[line.x1.baseVal.value, line.y1.baseVal.value], [line.x2.baseVal.value, line.y2.baseVal.value]].every(([x, y]) => {
        const point = new DOMPoint(x, y).matrixTransform(line.getScreenCTM()!);
        return peers.some((peer) => Math.abs(point.x - (peer.left + peer.width / 2)) < 2 && Math.abs(point.y - (peer.top + peer.height / 2)) < 2);
      });
    });
  })).toBe(true);
}

test("SEND conversations, Lab evidence exports, Replay controls and responsive viewports", async ({ browser }) => {
  // Five real browser peers, two accepted trials, six acceptance sizes and the
  // generated concept's native dimensions for direct visual comparison.
  test.setTimeout(120_000);
  await mkdir(screenshots, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, reducedMotion: "reduce" });
  const errors: string[] = [];
  const host = await context.newPage(); const peer = await context.newPage();
  host.on("pageerror", (error) => errors.push(error.message)); peer.on("pageerror", (error) => errors.push(error.message));
  try {
    await host.goto("/");
    await expect(host).toHaveTitle(/HOPNET/);
    // Typography is self-hosted: the presentation must not rely on a font CDN.
    expect(await host.evaluate(async () => {
      const loaded = await document.fonts.load('400 16px "Instrument Sans"');
      return loaded.length > 0 && getComputedStyle(document.documentElement).fontFamily.startsWith('"Instrument Sans"');
    })).toBe(true);
    await host.screenshot({ path: path.join(screenshots, "entry.png") });
    await host.getByLabel("Device name").fill("Studio Mac");
    await host.getByRole("button", { name: "Create private room" }).click();
    await host.screenshot({ path: path.join(screenshots, "empty-room.png"), mask: [host.getByRole("img", { name: "QR code to join this HOPNET room" })] });
    const qr = await host.getByRole("img", { name: "QR code to join this HOPNET room" }).getAttribute("src");
    const invitation = qr!.match(/\/rooms\/([^/]+)\/qr\?invite=([^&]+)/)!;
    await peer.goto(`/?room=${invitation[1]}&invite=${invitation[2]}`);
    await peer.getByLabel("Device name").fill("Studio Phone");
    await peer.getByLabel("Device type").selectOption("phone");
    await peer.getByRole("button", { name: "Request to join" }).click();
    await expect(host.getByRole("button", { name: "Admit", exact: true })).toBeVisible();
    await host.screenshot({ path: path.join(screenshots, "pending-admission.png"), mask: [host.getByRole("img", { name: "QR code to join this HOPNET room" })] });
    await host.getByRole("button", { name: "Admit", exact: true }).click();
    await expect(host.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    for (const name of ["Studio Mac B", "Studio Phone B", "Studio Phone C"]) {
      const extra = await context.newPage();
      await extra.goto(`/?room=${invitation[1]}&invite=${invitation[2]}`);
      await extra.getByLabel("Device name").fill(name);
      await extra.getByLabel("Device type").selectOption(name.includes("Phone") ? "phone" : "laptop");
      await extra.getByRole("button", { name: "Request to join" }).click();
      await host.getByRole("button", { name: "Admit", exact: true }).click();
      await host.getByRole("button", { name: new RegExp(`^${name},`) }).click();
      await expect(host.getByText("Direct WebRTC", { exact: true }).first()).toBeVisible({ timeout: 15_000 });
    }
    await host.getByRole("button", { name: /^Studio Phone,/ }).click();
    await expect(host.locator(".spatial-device")).toHaveCount(5);
    expect(await host.locator(".spatial-device img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    await expect(host.locator(".peer-inspector")).toHaveCSS("opacity", "1");
    await host.screenshot({ path: path.join(screenshots, "five-browser-peers.png"), animations: "disabled" });
    await host.getByRole("button", { name: "Open send view" }).click();
    await peer.getByRole("button", { name: "Open send view" }).click();
    await host.getByPlaceholder("Message this peer…").fill("A visible conversation, confirmed by the receiver.");
    await host.getByRole("button", { name: "Send", exact: true }).click();
    await expect(peer.getByLabel("Conversation history").getByText("A visible conversation, confirmed by the receiver.")).toBeVisible();
    await expect(host.getByLabel("Conversation history").getByText(/You.*delivered/)).toBeVisible();
    await host.screenshot({ path: path.join(screenshots, "send-conversation.png") });
    await host.getByRole("button", { name: "Open lab view" }).click();
    await host.getByLabel("Experiment preset").selectOption("direct-overlay");
    await host.getByLabel("Experiment test file").setInputFiles({ name: "lab-proof.bin", mimeType: "application/octet-stream", buffer: Buffer.from("real lab data over RTC") });
    await host.getByRole("button", { name: "Start experiment", exact: true }).click();
    await expect(peer.getByRole("button", { name: "Accept lab-proof.bin" })).toBeVisible();
    await expect(peer.getByTestId("transfer-receive")).toHaveCSS("opacity", "1");
    await peer.screenshot({ path: path.join(screenshots, "incoming-offer.png"), animations: "disabled" });
    await peer.getByRole("button", { name: "Accept lab-proof.bin" }).click();
    await expect(host.getByTestId("transfer-send")).toHaveAttribute("data-status", "verified");
    await expect(host.getByLabel("Experiment results").getByText("verified", { exact: true })).toBeVisible();
    const downloading = host.waitForEvent("download");
    await host.getByRole("button", { name: "Export JSON", exact: true }).click();
    const download = await downloading;
    const stream = await download.createReadStream();
    let raw = ""; for await (const part of stream!) raw += part.toString();
    const exported = JSON.parse(raw);
    expect(exported.results[0].status).toBe("verified");
    expect(exported.results[0].receiverAcknowledgedBytes).toBe(22);
    const csvDownload = host.waitForEvent("download");
    await host.getByRole("button", { name: "Export CSV", exact: true }).click();
    const csvStream = await (await csvDownload).createReadStream();
    let csv = ""; for await (const part of csvStream!) csv += part.toString();
    expect(csv).toContain('"receiverAcknowledgedBytes"');
    expect(csv).toContain('"verified","22"');
    await mkdir(path.resolve("docs/evidence"), { recursive: true });
    await writeFile(path.resolve("docs/evidence/automated-lab-trial.json"), raw);
    await host.screenshot({ path: path.join(screenshots, "lab-result.png") });
    // Exercise the actual host fault control, separately from the context-close
    // failure tested by resilience.spec.ts. This is labeled logical impairment.
    await host.getByLabel("Experiment preset").selectOption("relay-recovery");
    await host.getByLabel("Experiment test file").setInputFiles([]);
    const edge = (a: string, b: string) => host.getByRole("button", { name: new RegExp(`^(${a} ↔ ${b}|${b} ↔ ${a})$`) });
    await edge("Studio Mac", "Studio Phone").click();
    await edge("Studio Mac B", "Studio Phone").click();
    await edge("Studio Phone B", "Studio Phone").click();
    await expect(host.getByRole("button", { name: "Start experiment", exact: true })).toBeEnabled({ timeout: 15_000 });
    await host.getByRole("button", { name: "Start experiment", exact: true }).click();
    await peer.getByRole("button", { name: "Accept hopnet-repeatable-4MiB.bin" }).click();
    const bulk = host.getByTestId("transfer-send").filter({ hasText: "hopnet-repeatable-4MiB.bin" });
    await expect.poll(async () => JSON.parse(await bulk.getByTestId("transfer-evidence").textContent() ?? "{}").pathStats?.filter((item: { acknowledgedChunks: number }) => item.acknowledgedChunks > 0).length).toBe(2);
    await host.getByLabel("Failure relay").selectOption({ label: "Studio Mac B" });
    await host.getByRole("button", { name: "Disconnect relay links", exact: true }).click();
    await host.screenshot({ path: path.join(screenshots, "lab-active-recovery.png") });
    await expect(bulk).toHaveAttribute("data-status", "verified", { timeout: 45_000 });
    const recoveryDownload = host.waitForEvent("download");
    await host.getByRole("button", { name: "Export JSON", exact: true }).click();
    const recoveryStream = await (await recoveryDownload).createReadStream();
    let recoveryRaw = ""; for await (const part of recoveryStream!) recoveryRaw += part.toString();
    const recoveryResult = JSON.parse(recoveryRaw).results[0];
    expect(recoveryResult.status).toBe("verified");
    expect(recoveryResult.experiment.faultAt).toBeGreaterThan(0);
    expect(recoveryResult.recoveryMs).not.toBeNull();
    await expect(host.locator(".error-toast")).toHaveCount(0);
    await writeFile(path.resolve("docs/evidence/automated-lab-logical-recovery.json"), recoveryRaw);
    await host.getByRole("button", { name:"Restore relay links",exact:true }).click();
    await expect(edge("Studio Mac", "Studio Mac B")).toHaveAttribute("aria-pressed","true");
    await expect(edge("Studio Mac B", "Studio Phone")).toHaveAttribute("aria-description","established", { timeout:15_000 });
    for (const [width, height] of sizes) {
      await host.setViewportSize({ width: width!, height: height! });
      const mobile = width! <= 680;
      if (mobile) {
        await host.getByRole("button", { name: "Messages", exact: true }).click();
        await expect(host.getByLabel("Conversation history").getByText("A visible conversation, confirmed by the receiver.")).toBeVisible();
        await layout(host);
        await host.screenshot({ path: path.join(screenshots, `messages-${width}x${height}.png`), animations: "disabled" });
        await host.getByRole("button", { name: "Activity", exact: true }).click();
      } else {
        await host.getByRole("button", { name: "Open space view" }).click();
        await expect(host.getByRole("button", { name: "Open space view" })).toHaveClass(/active/);
        await expect(host.locator(".peer-inspector")).toHaveCSS("opacity", "1");
        await layout(host);
        await host.screenshot({ path: path.join(screenshots, `space-${width}x${height}.png`), animations: "disabled" });
        await host.getByRole("button", { name: "Open replay view" }).click();
      }
      await expect(host.getByRole("heading", { name: "Every hop has a story." })).toBeVisible();
      await host.getByLabel("Replay timeline").fill("1");
      await host.getByRole("button", { name: "Next event", exact: true }).click();
      await host.getByLabel("Replay speed").selectOption("4");
      await host.getByRole("button", { name: "Play replay", exact: true }).click();
      // Playback may finish a short journal immediately, so both terminal and paused states are valid.
      const pause = host.getByRole("button", { name: "Pause replay", exact: true });
      if (await pause.isVisible()) await pause.click();
      const verification = host.locator(".replay-event-list button").filter({ has: host.getByText("verified", { exact: true }) }).last();
      const verificationIndex = await verification.evaluate((button) => [...button.parentElement!.children].indexOf(button));
      await host.getByLabel("Replay timeline").fill(String(verificationIndex));
      await expect(host.getByLabel("Selected protocol event")).toBeVisible();
      await expect(host.getByLabel("Selected protocol event").getByRole("heading", { name: "verified", exact: true })).toBeVisible();
      await layout(host);
      await host.screenshot({ path: path.join(screenshots, `replay-${width}x${height}.png`), animations: "disabled" });
    }
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
