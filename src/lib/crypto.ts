import type { EncryptedPayload, MapEntry } from "@/lib/types";

// PBKDF2 cost and AES-GCM settings for client-side zero-knowledge encryption.
const ITERATIONS = 600_000;
const KEY_LENGTH = 256;
const IV_LENGTH = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  // Browser-safe binary -> base64 conversion for JSON transport.
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  // Reverse of toBase64.
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function randomBytes(length: number): Uint8Array {
  // Cryptographically secure random bytes for salt/iv.
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // Create a clean ArrayBuffer view for subtle crypto APIs.
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

async function deriveAesKey(password: string, pepper: string, salt: Uint8Array): Promise<CryptoKey> {
  // Pepper is never stored; it is mixed with password before PBKDF2.
  const combinedSecret = `${password}\u0000${pepper}`;
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(combinedSecret),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations: ITERATIONS,
    },
    baseKey,
    {
      name: "AES-GCM",
      length: KEY_LENGTH,
    },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptMap(map: MapEntry[], password: string, pepper: string): Promise<EncryptedPayload> {
  // Fresh salt and IV each encryption keep payloads unlinkable.
  const salt = randomBytes(16);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveAesKey(password, pepper, salt);
  const plaintextBytes = encoder.encode(JSON.stringify(map));

  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
    },
    key,
    plaintextBytes,
  );

  return {
    algorithm: "AES-GCM",
    iterations: ITERATIONS,
    saltB64: toBase64(salt),
    ivB64: toBase64(iv),
    ciphertextB64: toBase64(new Uint8Array(encrypted)),
  };
}

export async function decryptMap(payload: EncryptedPayload, password: string, pepper: string): Promise<MapEntry[]> {
  // Decryption only succeeds with matching password + pepper pair.
  const salt = fromBase64(payload.saltB64);
  const iv = fromBase64(payload.ivB64);
  const ciphertext = fromBase64(payload.ciphertextB64);
  const key = await deriveAesKey(password, pepper, salt);

  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
    },
    key,
    toArrayBuffer(ciphertext),
  );

  return JSON.parse(decoder.decode(decrypted)) as MapEntry[];
}
