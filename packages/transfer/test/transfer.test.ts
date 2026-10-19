import assert from "node:assert/strict";
import test from "node:test";
import { TransferAssembler, base64ToBytes, bytesToBase64, createManifest } from "../src/index.ts";

test("chunks, verifies, and reassembles bytes in any arrival order", async () => {
  const source = new TextEncoder().encode("HOPNET integrity payload ".repeat(2_000));
  const { manifest, chunks } = await createManifest("field/notes?.txt", "text/plain", source, 4_096);
  const assembler = new TransferAssembler(manifest);
  for (let index = chunks.length - 1; index >= 0; index -= 1) {
    const chunk = chunks[index]!;
    await assembler.add(index, base64ToBytes(bytesToBase64(chunk)), manifest.chunkHashes[index]!);
  }
  const result = await assembler.assemble();
  assert.deepEqual(result.bytes, source);
  assert.equal(result.hash, manifest.fileHash);
  assert.equal(manifest.name, "field_notes_.txt");
});

test("rejects a chunk whose content does not match its declared hash", async () => {
  const source = new TextEncoder().encode("verified bytes");
  const { manifest } = await createManifest("proof.bin", "application/octet-stream", source);
  const assembler = new TransferAssembler(manifest);
  await assert.rejects(() => assembler.add(0, new TextEncoder().encode("tampered bytes"), manifest.chunkHashes[0]!), /integrity|length/i);
});

test("does not report a whole file before every chunk arrives", async () => {
  const source = new Uint8Array(20_000).fill(7);
  const { manifest, chunks } = await createManifest("sample.bin", "application/octet-stream", source, 8_192);
  const assembler = new TransferAssembler(manifest);
  await assembler.add(0, chunks[0]!, manifest.chunkHashes[0]!);
  await assert.rejects(() => assembler.assemble(), /incomplete/i);
});

test("rejects inconsistent chunk counts before allocating receiver state", async () => {
  const source = new Uint8Array(20_000).fill(2);
  const { manifest } = await createManifest("sample.bin", "application/octet-stream", source, 8_192);
  assert.throws(() => new TransferAssembler({ ...manifest, chunkCount: 2 }), /chunk count/);
});
