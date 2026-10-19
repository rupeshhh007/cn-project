export const DEFAULT_CHUNK_BYTES = 12 * 1024;
export const MAX_FILE_BYTES = 32 * 1024 * 1024;
export const MAX_CHUNKS = Math.ceil(MAX_FILE_BYTES / DEFAULT_CHUNK_BYTES);

export type TransferManifest = {
  name: string;
  mime: string;
  size: number;
  chunkSize: number;
  chunkCount: number;
  fileHash: string;
  chunkHashes: string[];
};

export async function sha256(bytes: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("File integrity requires a secure browser context with Web Crypto.");
  const source = new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", source.buffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function splitBytes(bytes: Uint8Array, chunkSize = DEFAULT_CHUNK_BYTES): Uint8Array[] {
  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 16 * 1024) throw new Error("Chunk size must be between 1 and 16384 bytes.");
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) chunks.push(bytes.slice(offset, Math.min(bytes.byteLength, offset + chunkSize)));
  return chunks;
}

export async function createManifest(name: string, mime: string, bytes: Uint8Array, chunkSize = DEFAULT_CHUNK_BYTES): Promise<{ manifest: TransferManifest; chunks: Uint8Array[] }> {
  if (bytes.byteLength < 1) throw new Error("Empty files are not supported.");
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error(`Files are limited to ${MAX_FILE_BYTES} bytes.`);
  const chunks = splitBytes(bytes, chunkSize);
  const chunkHashes = await Promise.all(chunks.map((chunk) => sha256(chunk)));
  return {
    manifest: {
      name: safeFileName(name),
      mime: mime.slice(0, 120),
      size: bytes.byteLength,
      chunkSize,
      chunkCount: chunks.length,
      fileHash: await sha256(bytes),
      chunkHashes,
    },
    chunks,
  };
}

export class TransferAssembler {
  private readonly chunks = new Map<number, Uint8Array>();
  private receivedBytes = 0;

  constructor(readonly manifest: TransferManifest) {
    if (manifest.size < 1 || manifest.size > MAX_FILE_BYTES) throw new Error("Manifest file size is outside the accepted limit.");
    if (!Number.isInteger(manifest.chunkSize) || manifest.chunkSize < 1 || manifest.chunkSize > 16 * 1024) throw new Error("Manifest chunk size is outside the accepted limit.");
    if (manifest.chunkCount !== Math.ceil(manifest.size / manifest.chunkSize)) throw new Error("Manifest chunk count does not match the file size.");
    if (manifest.chunkCount < 1 || manifest.chunkCount > MAX_CHUNKS || manifest.chunkHashes.length !== manifest.chunkCount) throw new Error("Manifest chunk metadata is invalid.");
    if (!/^[0-9a-f]{64}$/.test(manifest.fileHash) || manifest.chunkHashes.some((hash) => !/^[0-9a-f]{64}$/.test(hash))) throw new Error("Manifest contains an invalid SHA-256 hash.");
  }

  get receivedCount(): number { return this.chunks.size; }
  get bytesReceived(): number { return this.receivedBytes; }
  get complete(): boolean { return this.chunks.size === this.manifest.chunkCount; }

  async add(index: number, bytes: Uint8Array, declaredHash: string): Promise<"stored" | "duplicate"> {
    if (!Number.isInteger(index) || index < 0 || index >= this.manifest.chunkCount) throw new Error("Chunk index is outside the manifest.");
    if (bytes.byteLength > this.manifest.chunkSize) throw new Error("Chunk exceeds the manifest chunk size.");
    const expectedLength = index === this.manifest.chunkCount - 1 ? this.manifest.size - this.manifest.chunkSize * index : this.manifest.chunkSize;
    if (bytes.byteLength !== expectedLength) throw new Error("Chunk length does not match the manifest.");
    const expectedHash = this.manifest.chunkHashes[index];
    if (!expectedHash || declaredHash !== expectedHash || await sha256(bytes) !== expectedHash) throw new Error("Chunk integrity verification failed.");
    if (this.chunks.has(index)) return "duplicate";
    this.chunks.set(index, new Uint8Array(bytes));
    this.receivedBytes += bytes.byteLength;
    return "stored";
  }

  async assemble(): Promise<{ bytes: Uint8Array; hash: string }> {
    if (!this.complete) throw new Error("Transfer is incomplete.");
    const bytes = new Uint8Array(this.manifest.size);
    let offset = 0;
    for (let index = 0; index < this.manifest.chunkCount; index += 1) {
      const chunk = this.chunks.get(index);
      if (!chunk) throw new Error(`Chunk ${index} is missing.`);
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const hash = await sha256(bytes);
    if (hash !== this.manifest.fileHash) throw new Error("Whole-file integrity verification failed.");
    return { bytes, hash };
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function safeFileName(value: string): string {
  const cleaned = value.replace(/[\\/\u0000-\u001F\u007F<>:|?*]/g, "_").trim().slice(0, 180);
  return cleaned || "hopnet-transfer.bin";
}
