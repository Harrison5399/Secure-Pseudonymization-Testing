import {
  base64ToBytes,
  bestEffortWipe,
  bytesToBase64,
  bytesToUtf8,
  randomBytes,
  toArrayBuffer,
  utf8ToBytes,
} from "./encoding";
import type { DeriveMasterKeyResult, EnvelopeBundle } from "./types";

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_SALT_BYTES = 16;
const GCM_IV_BYTES = 12;

export async function deriveMasterKeyFromPassword(
  password: string,
  options?: {
    saltB64?: string;
    iterations?: number;
  },
): Promise<DeriveMasterKeyResult> {
  const iterations = options?.iterations ?? PBKDF2_ITERATIONS;
  const salt = options?.saltB64 ? base64ToBytes(options.saltB64) : randomBytes(PBKDF2_SALT_BYTES);

  const passwordKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(utf8ToBytes(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      iterations,
    },
    passwordKey,
    256,
  );

  const derivedBytes = new Uint8Array(derivedBits);
  const derivedKeyB64 = bytesToBase64(derivedBytes);

  const masterKey = await crypto.subtle.importKey("raw", derivedBits, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);

  bestEffortWipe(derivedBytes);

  return {
    masterKey,
    saltB64: bytesToBase64(salt),
    iterations,
    derivedKeyB64,
  };
}

export async function deriveHkdfContextAad(masterKeyMaterialB64: string, context: string): Promise<string> {
  const masterBytes = base64ToBytes(masterKeyMaterialB64);
  const hkdfBase = await crypto.subtle.importKey("raw", toArrayBuffer(masterBytes), "HKDF", false, ["deriveBits"]);
  const aadBits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(utf8ToBytes("demo-hkdf-salt")),
      info: toArrayBuffer(utf8ToBytes(`aad:${context}`)),
    },
    hkdfBase,
    128,
  );

  bestEffortWipe(masterBytes);

  return bytesToBase64(new Uint8Array(aadBits));
}

export async function generateDataEncryptionKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function encryptWithDek(
  plaintext: string,
  dek: CryptoKey,
  aadB64?: string,
): Promise<{ ciphertextB64: string; ivB64: string }> {
  const iv = randomBytes(GCM_IV_BYTES);
  const plaintextBytes = utf8ToBytes(plaintext);

  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: aadB64 ? toArrayBuffer(base64ToBytes(aadB64)) : undefined,
    },
    dek,
    toArrayBuffer(plaintextBytes),
  );

  return {
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
    ivB64: bytesToBase64(iv),
  };
}

export async function decryptWithDek(
  ciphertextB64: string,
  ivB64: string,
  dek: CryptoKey,
  aadB64?: string,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(ivB64)),
      additionalData: aadB64 ? toArrayBuffer(base64ToBytes(aadB64)) : undefined,
    },
    dek,
    toArrayBuffer(base64ToBytes(ciphertextB64)),
  );

  return bytesToUtf8(plaintext);
}

export async function wrapDekWithMasterKey(
  dek: CryptoKey,
  masterKey: CryptoKey,
): Promise<{ wrappedDekB64: string; wrapIvB64: string }> {
  const rawDek = new Uint8Array(await crypto.subtle.exportKey("raw", dek));
  const wrapIv = randomBytes(GCM_IV_BYTES);

  const wrapped = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(wrapIv),
    },
    masterKey,
    toArrayBuffer(rawDek),
  );

  bestEffortWipe(rawDek);

  return {
    wrappedDekB64: bytesToBase64(new Uint8Array(wrapped)),
    wrapIvB64: bytesToBase64(wrapIv),
  };
}

export async function unwrapDekWithMasterKey(
  wrappedDekB64: string,
  wrapIvB64: string,
  masterKey: CryptoKey,
): Promise<CryptoKey> {
  const rawDek = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(base64ToBytes(wrapIvB64)),
    },
    masterKey,
    toArrayBuffer(base64ToBytes(wrappedDekB64)),
  );

  return crypto.subtle.importKey("raw", rawDek, { name: "AES-GCM" }, false, ["decrypt", "encrypt"]);
}

export function buildEnvelopeBundle(input: {
  id: string;
  userId: string;
  ciphertextB64: string;
  contentIvB64: string;
  wrappedDekB64: string;
  wrapIvB64: string;
  aadB64?: string;
  noteLabel?: string;
  hkdfContext?: string;
}): EnvelopeBundle {
  return {
    id: input.id,
    userId: input.userId,
    algorithm: "AES-256-GCM",
    encryptedAt: new Date().toISOString(),
    ciphertextB64: input.ciphertextB64,
    contentIvB64: input.contentIvB64,
    wrappedDekB64: input.wrappedDekB64,
    wrapIvB64: input.wrapIvB64,
    ...(input.aadB64 !== undefined ? { aadB64: input.aadB64 } : {}),
    metadata: {
      version: "client-envelope-v1",
      ...(input.noteLabel !== undefined ? { noteLabel: input.noteLabel } : {}),
      ...(input.hkdfContext !== undefined ? { hkdfContext: input.hkdfContext } : {}),
    },
  };
}
