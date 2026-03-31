import type { EncryptOptions, WrappedPayload } from "./types";

const DEFAULT_ITERATIONS = 600_000;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new Uint8Array(bytes.byteLength);
  out.set(bytes);
  return out.buffer;
}

/**
 * Client-side envelope encryption helper.
 * Security note: key material should never be sent to backend services.
 */
export class ClientEncryption {
  /**
   * Derives a wrapping key from passphrase material in-browser.
   */
  async deriveWrappingKey(passphrase: string, salt: Uint8Array, iterations = DEFAULT_ITERATIONS): Promise<CryptoKey> {
    const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  /**
   * Encrypts plaintext with envelope encryption using a random DEK.
   */
  async encrypt(plaintext: string, passphrase: string, options: EncryptOptions = {}): Promise<WrappedPayload> {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const contentIv = crypto.getRandomValues(new Uint8Array(12));
    const wrapIv = crypto.getRandomValues(new Uint8Array(12));
    const iterations = options.iterations ?? DEFAULT_ITERATIONS;

    const wrappingKey = await this.deriveWrappingKey(passphrase, salt, iterations);
    const dek = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const aad = options.aadB64 ? Uint8Array.from(atob(options.aadB64), (c) => c.charCodeAt(0)) : undefined;

    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toArrayBuffer(contentIv),
        additionalData: aad ? toArrayBuffer(aad) : undefined,
      },
      dek,
      toArrayBuffer(new TextEncoder().encode(plaintext)),
    );

    const rawDek = new Uint8Array(await crypto.subtle.exportKey("raw", dek));
    const wrappedDek = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toArrayBuffer(wrapIv) },
      wrappingKey,
      toArrayBuffer(rawDek),
    );

    return {
      ciphertextB64: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
      ivB64: btoa(String.fromCharCode(...contentIv)),
      wrappedDekB64: btoa(String.fromCharCode(...new Uint8Array(wrappedDek))),
      wrapIvB64: btoa(String.fromCharCode(...wrapIv)),
      saltB64: btoa(String.fromCharCode(...salt)),
      iterations,
    };
  }
}
