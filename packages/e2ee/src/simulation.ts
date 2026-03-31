import {
  Direction,
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  type DeviceType,
  type KeyPairType,
  type SessionRecordType,
  type StorageType,
} from "@privacyresearch/libsignal-protocol-typescript";
import { base64ToBytes, bytesToBase64, randomBytes, toArrayBuffer, utf8ToBytes, bytesToUtf8 } from "./encoding";
import type { DeviceKeySet } from "./types";

export type SignalCiphertext = {
  type: number;
  body: string;
  registrationId?: number;
};

export type SignalClientContext = {
  name: string;
  deviceId: number;
  address: SignalProtocolAddress;
  addressString: string;
  registrationId: number;
  identityPublicB64: string;
  signedPreKeyPublicB64: string;
  preKeyPublicB64: string;
  preKeyBundle: DeviceType<ArrayBuffer>;
  store: StorageType;
};

class InMemorySignalStore implements StorageType {
  private readonly identityKeyPair: KeyPairType<ArrayBuffer>;
  private readonly registrationId: number;
  private readonly identities = new Map<string, ArrayBuffer>();
  private readonly preKeys = new Map<string, KeyPairType<ArrayBuffer>>();
  private readonly signedPreKeys = new Map<string, KeyPairType<ArrayBuffer>>();
  private readonly sessions = new Map<string, SessionRecordType>();

  constructor(identityKeyPair: KeyPairType<ArrayBuffer>, registrationId: number) {
    this.identityKeyPair = identityKeyPair;
    this.registrationId = registrationId;
  }

  async getIdentityKeyPair(): Promise<KeyPairType<ArrayBuffer>> {
    return this.identityKeyPair;
  }

  async getLocalRegistrationId(): Promise<number> {
    return this.registrationId;
  }

  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer, direction: Direction): Promise<boolean> {
    void direction;
    const known = this.identities.get(identifier);
    if (!known) {
      return true;
    }
    return bytesToBase64(new Uint8Array(known)) === bytesToBase64(new Uint8Array(identityKey));
  }

  async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer): Promise<boolean> {
    const known = this.identities.get(encodedAddress);
    this.identities.set(encodedAddress, publicKey);

    if (!known) {
      return true;
    }

    return bytesToBase64(new Uint8Array(known)) !== bytesToBase64(new Uint8Array(publicKey));
  }

  async loadPreKey(encodedAddress: string | number): Promise<KeyPairType<ArrayBuffer> | undefined> {
    return this.preKeys.get(String(encodedAddress));
  }

  async storePreKey(keyId: number | string, keyPair: KeyPairType<ArrayBuffer>): Promise<void> {
    this.preKeys.set(String(keyId), keyPair);
  }

  async removePreKey(keyId: number | string): Promise<void> {
    this.preKeys.delete(String(keyId));
  }

  async storeSession(encodedAddress: string, record: SessionRecordType): Promise<void> {
    this.sessions.set(encodedAddress, record);
  }

  async loadSession(encodedAddress: string): Promise<SessionRecordType | undefined> {
    return this.sessions.get(encodedAddress);
  }

  async loadSignedPreKey(keyId: number | string): Promise<KeyPairType<ArrayBuffer> | undefined> {
    return this.signedPreKeys.get(String(keyId));
  }

  async storeSignedPreKey(keyId: number | string, keyPair: KeyPairType<ArrayBuffer>): Promise<void> {
    this.signedPreKeys.set(String(keyId), keyPair);
  }

  async removeSignedPreKey(keyId: number | string): Promise<void> {
    this.signedPreKeys.delete(String(keyId));
  }
}

export async function createSignalClient(name: string, deviceId = 1): Promise<SignalClientContext> {
  const registrationId = KeyHelper.generateRegistrationId();
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const preKey = await KeyHelper.generatePreKey(1);
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, 1);
  const store = new InMemorySignalStore(identityKeyPair, registrationId);

  await store.storePreKey(preKey.keyId, preKey.keyPair);
  await store.storeSignedPreKey(signedPreKey.keyId, signedPreKey.keyPair);

  const address = new SignalProtocolAddress(name, deviceId);

  return {
    name,
    deviceId,
    address,
    addressString: address.toString(),
    registrationId,
    identityPublicB64: bytesToBase64(new Uint8Array(identityKeyPair.pubKey)),
    signedPreKeyPublicB64: bytesToBase64(new Uint8Array(signedPreKey.keyPair.pubKey)),
    preKeyPublicB64: bytesToBase64(new Uint8Array(preKey.keyPair.pubKey)),
    preKeyBundle: {
      registrationId,
      identityKey: identityKeyPair.pubKey,
      signedPreKey: {
        keyId: signedPreKey.keyId,
        publicKey: signedPreKey.keyPair.pubKey,
        signature: signedPreKey.signature,
      },
      preKey: {
        keyId: preKey.keyId,
        publicKey: preKey.keyPair.pubKey,
      },
    },
    store,
  };
}

export async function establishSessionFromPreKey(
  sender: SignalClientContext,
  recipient: SignalClientContext,
): Promise<void> {
  const builder = new SessionBuilder(sender.store, recipient.address);
  await builder.processPreKey(recipient.preKeyBundle);
}

export async function encryptSignalMessage(
  sender: SignalClientContext,
  recipient: SignalClientContext,
  message: string,
): Promise<SignalCiphertext> {
  const cipher = new SessionCipher(sender.store, recipient.address);
  const encrypted = await cipher.encrypt(toArrayBuffer(utf8ToBytes(message)));

  if (!encrypted.body) {
    throw new Error("libsignal returned empty ciphertext body");
  }

  return {
    type: encrypted.type,
    body: encrypted.body,
    ...(encrypted.registrationId !== undefined ? { registrationId: encrypted.registrationId } : {}),
  };
}

export async function decryptSignalMessage(
  recipient: SignalClientContext,
  sender: SignalClientContext,
  packet: SignalCiphertext,
): Promise<string> {
  const cipher = new SessionCipher(recipient.store, sender.address);

  let plaintext: ArrayBuffer;
  if (packet.type === 3) {
    plaintext = await cipher.decryptPreKeyWhisperMessage(packet.body, "binary");
  } else {
    plaintext = await cipher.decryptWhisperMessage(packet.body, "binary");
  }

  return bytesToUtf8(plaintext);
}

export async function hasOpenSession(sender: SignalClientContext, recipient: SignalClientContext): Promise<boolean> {
  const cipher = new SessionCipher(sender.store, recipient.address);
  return cipher.hasOpenSession();
}

export async function generateDeviceKeys(): Promise<DeviceKeySet> {
  const identity = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);
  const signed = await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"]);

  if (!("privateKey" in identity) || !("publicKey" in identity) || !("privateKey" in signed) || !("publicKey" in signed)) {
    throw new Error("X25519 key pair generation is not supported in this runtime");
  }

  const identityKeyPair: CryptoKeyPair = identity;
  const signedPreKeyPair: CryptoKeyPair = signed;
  const identityPublic = await crypto.subtle.exportKey("raw", identityKeyPair.publicKey);
  const signedPreKeyPublic = await crypto.subtle.exportKey("raw", signedPreKeyPair.publicKey);

  return {
    identityKeyPair,
    signedPreKeyPair,
    identityPublicB64: bytesToBase64(new Uint8Array(identityPublic)),
    signedPreKeyPublicB64: bytesToBase64(new Uint8Array(signedPreKeyPublic)),
  };
}

export async function importX25519PublicKey(publicKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(base64ToBytes(publicKeyB64)), { name: "X25519" }, true, []);
}

export async function importX25519PrivateKey(privatePkcs8B64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    toArrayBuffer(base64ToBytes(privatePkcs8B64)),
    { name: "X25519" },
    false,
    ["deriveBits"],
  );
}

export async function deriveSharedSecretB64(privateKey: CryptoKey, remotePublicKey: CryptoKey): Promise<string> {
  const bits = await crypto.subtle.deriveBits(
    {
      name: "X25519",
      public: remotePublicKey,
    },
    privateKey,
    256,
  );

  return bytesToBase64(new Uint8Array(bits));
}

export async function ratchetStep(chainKeyB64: string): Promise<{ messageKeyB64: string; nextChainKeyB64: string }> {
  const chainKey = base64ToBytes(chainKeyB64);
  const hkdfKey = await crypto.subtle.importKey("raw", toArrayBuffer(chainKey), "HKDF", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(randomBytes(32)),
      info: toArrayBuffer(utf8ToBytes("demo-double-ratchet-step")),
    },
    hkdfKey,
    512,
  );

  const bytes = new Uint8Array(derived);
  return {
    messageKeyB64: bytesToBase64(bytes.slice(0, 32)),
    nextChainKeyB64: bytesToBase64(bytes.slice(32, 64)),
  };
}

async function importMessageAesKey(messageKeyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toArrayBuffer(base64ToBytes(messageKeyB64)), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptRatchetMessage(message: string, messageKeyB64: string): Promise<{ ciphertextB64: string; ivB64: string }> {
  const key = await importMessageAesKey(messageKeyB64);
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: toArrayBuffer(iv) }, key, toArrayBuffer(utf8ToBytes(message)));

  return {
    ciphertextB64: bytesToBase64(new Uint8Array(ciphertext)),
    ivB64: bytesToBase64(iv),
  };
}

export async function decryptRatchetMessage(ciphertextB64: string, ivB64: string, messageKeyB64: string): Promise<string> {
  const key = await importMessageAesKey(messageKeyB64);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(ivB64)) },
    key,
    toArrayBuffer(base64ToBytes(ciphertextB64)),
  );

  return bytesToUtf8(plaintext);
}
