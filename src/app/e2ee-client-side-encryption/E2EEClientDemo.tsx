"use client";

/**
 * Primary E2EE demo UI: payload encryption, per-device messaging, and trace visualization.
 */

import { useCallback, useMemo, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import {
  buildEnvelopeBundle,
  decryptWithDek,
  deriveHkdfContextAad,
  deriveMasterKeyFromPassword,
  encryptWithDek,
  generateDataEncryptionKey,
  unwrapDekWithMasterKey,
  wrapDekWithMasterKey,
} from "@/lib/crypto/client-encryption";
import {
  decryptRatchetMessage,
  deriveSharedSecretB64,
  encryptRatchetMessage,
  importX25519PrivateKey,
  importX25519PublicKey,
} from "@/lib/crypto/e2ee-simulation";
import { base64ToBytes, bytesToBase64, toArrayBuffer, utf8ToBytes } from "@/lib/crypto/encoding";
import {
  clearLocalBundles,
  clearLocalDeviceKey,
  getLocalDeviceKey,
  getLocalDeviceKeyRing,
  listLocalBundles,
  saveLocalBundle,
  saveLocalDeviceKeyRing,
  type LocalDeviceKeyMaterial,
  type LocalDeviceKeyRing,
} from "@/lib/crypto/storage";
import type { EnvelopeBundle, StepRecord } from "@/lib/crypto/types";

type Props = {
  sessionUser: {
    id: string;
    name: string | null;
    email: string | null;
  };
};

type DemoTab = "payload" | "messaging" | "trace";

type MessageRecord = {
  id: string;
  senderId: string;
  recipientId: string;
  content: string;
  createdAt: string;
  sender: { id: string; username: string; name: string | null; email: string };
  recipient: { id: string; username: string; name: string | null; email: string };
};

type E2EEPacketV1 = {
  version: "email-e2ee-v1";
  algorithm: "X25519+AES-256-GCM";
  senderPublicB64: string;
  ciphertextB64: string;
  ivB64: string;
  createdAt: string;
};

type E2EECopy = {
  forUserId: string;
  deviceId: string;
  keyId: string;
  keyVersion: string;
  ciphertextB64: string;
  ivB64: string;
};

type E2EEPacketV2 = {
  version: "email-e2ee-v2";
  algorithm: "X25519+AES-256-GCM";
  senderEmail: string;
  recipientEmail: string;
  senderPublicB64: string;
  senderKeyId: string;
  senderKeyVersion: string;
  recipientKeyId: string;
  recipientKeyVersion: string;
  createdAt: string;
  copies: {
    recipient: E2EECopy;
    sender: E2EECopy;
  };
};

type E2EEPacketV3 = {
  version: "email-e2ee-v3";
  algorithm: "X25519+AES-256-GCM";
  senderUserId: string;
  recipientUserId: string;
  senderEmail: string;
  recipientEmail: string;
  senderPublicB64: string;
  senderDeviceId: string;
  senderKeyId: string;
  senderKeyVersion: string;
  createdAt: string;
  copies: {
    recipient: E2EECopy[];
    sender: E2EECopy[];
  };
};

type ParsedPacket = E2EEPacketV1 | E2EEPacketV2 | E2EEPacketV3;

type DirectoryPublicKey = {
  deviceId: string;
  identityPublicB64: string;
  algorithm: string;
  keyId: string;
  keyVersion: string;
};

function JsonBox({ value }: { value: unknown }) {
  return (
    <pre className="max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

// Generates random bytes in hex form, with a Math.random fallback for constrained runtimes.
function randomHex(bytes: number): string {
  const values = new Uint8Array(bytes);

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(values);
  } else {
    for (let i = 0; i < bytes; i += 1) {
      values[i] = Math.floor(Math.random() * 256);
    }
  }

  return Array.from(values)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// Produces a UUID-like identifier even when crypto.randomUUID is unavailable.
function makeUuidLike(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  // Fallback for runtimes missing crypto.randomUUID (older mobile browsers/webviews).
  const part1 = randomHex(4);
  const part2 = randomHex(2);
  const part3 = `4${randomHex(2).slice(1)}`;
  const variantNibble = ((parseInt(randomHex(1), 16) & 0x3) | 0x8).toString(16);
  const part4 = `${variantNibble}${randomHex(2).slice(1)}`;
  const part5 = randomHex(6);

  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

// Enforces required browser capabilities for E2EE flows.
function ensureE2EERuntimeOrThrow(): void {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("E2EE requires a secure context (HTTPS) on mobile. Use localhost or an HTTPS tunnel.");
  }

  if (!crypto?.subtle) {
    throw new Error("Web Crypto Subtle API is unavailable in this browser/context.");
  }
}

// Creates/persists a stable browser-scoped device id for key-directory fan-out.
function getOrCreateDeviceId(userId: string): string {
  if (typeof window === "undefined") {
    return `web-${userId.slice(0, 8)}`;
  }

  const storageKey = `e2ee-device-id:${userId}`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const generated = `web-${makeUuidLike().slice(0, 8)}`;
  window.localStorage.setItem(storageKey, generated);
  return generated;
}

async function deriveMessageKeyB64(sharedSecretB64: string): Promise<string> {
  const shared = base64ToBytes(sharedSecretB64);
  const label = utf8ToBytes("email-e2ee-v1-message-key");
  const data = new Uint8Array(shared.length + label.length);
  data.set(shared, 0);
  data.set(label, shared.length);

  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToBase64(new Uint8Array(digest));
}

async function buildKeyId(identityPublicB64: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(utf8ToBytes(identityPublicB64)));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

async function createLocalKeyMaterial(userId: string, keyVersion: number): Promise<LocalDeviceKeyMaterial> {
  ensureE2EERuntimeOrThrow();

  let pair: CryptoKeyPair;
  try {
    pair = (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
  } catch {
    throw new Error("X25519 is not supported in this browser/runtime. Try latest Chrome/Edge on HTTPS or localhost.");
  }

  const pubRaw = await crypto.subtle.exportKey("raw", pair.publicKey);
  const privPkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const identityPublicB64 = bytesToBase64(new Uint8Array(pubRaw));

  return {
    keyId: await buildKeyId(identityPublicB64),
    keyVersion,
    userId,
    algorithm: "X25519",
    identityPublicB64,
    identityPrivatePkcs8B64: bytesToBase64(new Uint8Array(privPkcs8)),
    createdAt: new Date().toISOString(),
  };
}

function parsePacket(content: string): ParsedPacket | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }
    const value = parsed as Record<string, unknown>;

    if (
      value.version === "email-e2ee-v3" &&
      typeof value.senderUserId === "string" &&
      typeof value.recipientUserId === "string" &&
      typeof value.senderEmail === "string" &&
      typeof value.recipientEmail === "string" &&
      typeof value.senderPublicB64 === "string" &&
      typeof value.senderDeviceId === "string" &&
      typeof value.senderKeyId === "string" &&
      typeof value.senderKeyVersion === "string" &&
      value.copies &&
      typeof value.copies === "object" &&
      Array.isArray((value.copies as { recipient?: E2EECopy[] }).recipient) &&
      Array.isArray((value.copies as { sender?: E2EECopy[] }).sender)
    ) {
      return value as unknown as E2EEPacketV3;
    }

    if (
      value.version === "email-e2ee-v2" &&
      typeof value.senderEmail === "string" &&
      typeof value.recipientEmail === "string" &&
      typeof value.senderPublicB64 === "string" &&
      typeof value.senderKeyId === "string" &&
      typeof value.recipientKeyId === "string" &&
      typeof value.senderKeyVersion === "string" &&
      typeof value.recipientKeyVersion === "string" &&
      value.copies &&
      typeof value.copies === "object" &&
      typeof (value.copies as { recipient?: E2EECopy }).recipient?.ciphertextB64 === "string" &&
      typeof (value.copies as { recipient?: E2EECopy }).recipient?.ivB64 === "string" &&
      typeof (value.copies as { sender?: E2EECopy }).sender?.ciphertextB64 === "string" &&
      typeof (value.copies as { sender?: E2EECopy }).sender?.ivB64 === "string"
    ) {
      return value as unknown as E2EEPacketV2;
    }

    if (
      value.version === "email-e2ee-v1" &&
      typeof value.ciphertextB64 === "string" &&
      typeof value.ivB64 === "string" &&
      typeof value.senderPublicB64 === "string"
    ) {
      return value as unknown as E2EEPacketV1;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Drives all interactive client-side encryption and E2EE messaging demos.
 */
export default function E2EEClientDemo({ sessionUser }: Props) {
  const [activeTab, setActiveTab] = useState<DemoTab>("payload");

  // Shared trace log used by both payload and messaging demos.
  const [steps, setSteps] = useState<StepRecord[]>([]);
  const pushStep = useCallback((section: string, functionName: string, inputs: unknown, output: unknown) => {
    setSteps((prev) => [{ section, functionName, inputs, output, at: new Date().toISOString() }, ...prev]);
  }, []);

  // Payload encryption demo state.
  const masterKeyRef = useRef<CryptoKey | null>(null);
  const [payloadPassword, setPayloadPassword] = useState("");
  const [unlockMeta, setUnlockMeta] = useState<{ saltB64: string; iterations: number } | null>(null);
  const [payloadInput, setPayloadInput] = useState(
    "{\"customer\":\"alice@example.com\",\"amount\":2400000,\"note\":\"Q3 launch budget\"}",
  );
  const [payloadLabel, setPayloadLabel] = useState("Sensitive payload");
  const [latestBundleId, setLatestBundleId] = useState<string | null>(null);
  const [payloadPlaintext, setPayloadPlaintext] = useState<string>("");
  const [payloadRetrievedClient, setPayloadRetrievedClient] = useState<EnvelopeBundle | null>(null);
  const [payloadRetrievedServer, setPayloadRetrievedServer] = useState<unknown>(null);
  const [payloadStatus, setPayloadStatus] = useState<string>("");

  // Email-based E2EE messaging state.
  const [recipientEmail, setRecipientEmail] = useState("");
  const [messageInput, setMessageInput] = useState("Hello. This is encrypted client-side before upload.");
  const [inbox, setInbox] = useState<MessageRecord[]>([]);
  const [decryptedInbox, setDecryptedInbox] = useState<Record<string, string>>({});
  const [messageStatus, setMessageStatus] = useState("");
  const [msgRetrievedClient, setMsgRetrievedClient] = useState<unknown>(null);
  const [msgRetrievedServer, setMsgRetrievedServer] = useState<unknown>(null);
  const [decryptErrors, setDecryptErrors] = useState<Record<string, string>>({});
  const [keyStatus, setKeyStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const runtimeDiagnostics = useMemo(
    () => ({
      isSecureContext: typeof window !== "undefined" ? window.isSecureContext : null,
      hasCrypto: typeof crypto !== "undefined",
      hasSubtle: typeof crypto !== "undefined" ? Boolean(crypto?.subtle) : false,
    }),
    [],
  );

  const unlockSummary = useMemo(
    () => ({
      unlocked: Boolean(masterKeyRef.current),
      saltB64: unlockMeta?.saltB64 ?? null,
      iterations: unlockMeta?.iterations ?? null,
    }),
    [unlockMeta],
  );

  async function unlockPayloadKey() {
    setPayloadStatus("");
    if (!payloadPassword) {
      setPayloadStatus("Enter a password first.");
      return;
    }

    const derived = await deriveMasterKeyFromPassword(payloadPassword);
    masterKeyRef.current = derived.masterKey;
    setUnlockMeta({ saltB64: derived.saltB64, iterations: derived.iterations });

    pushStep(
      "Payload Encryption",
      "deriveMasterKeyFromPassword",
      { passwordLength: payloadPassword.length },
      { saltB64: derived.saltB64, iterations: derived.iterations },
    );

    setPayloadStatus("Payload key unlocked in memory.");
  }

  async function encryptPayloadAndStore() {
    setBusy(true);
    setPayloadStatus("");

    try {
      if (!masterKeyRef.current) {
        setPayloadStatus("Unlock key first.");
        return;
      }

      const id = crypto.randomUUID();
      const aadB64 = await deriveHkdfContextAad(bytesToBase64(utf8ToBytes(payloadPassword)), `payload:${id}`);
      pushStep("Payload Encryption", "deriveHkdfContextAad", { id }, { aadB64 });

      const dek = await generateDataEncryptionKey();
      pushStep("Payload Encryption", "generateDataEncryptionKey", {}, { ok: true });

      const encrypted = await encryptWithDek(payloadInput, dek, aadB64);
      pushStep("Payload Encryption", "encryptWithDek", { payloadLength: payloadInput.length }, encrypted);

      const wrapped = await wrapDekWithMasterKey(dek, masterKeyRef.current);
      pushStep("Payload Encryption", "wrapDekWithMasterKey", { id }, wrapped);

      const bundle = buildEnvelopeBundle({
        id,
        userId: sessionUser.id,
        ciphertextB64: encrypted.ciphertextB64,
        contentIvB64: encrypted.ivB64,
        wrappedDekB64: wrapped.wrappedDekB64,
        wrapIvB64: wrapped.wrapIvB64,
        aadB64,
        noteLabel: payloadLabel,
        hkdfContext: `payload:${id}`,
      });

      await saveLocalBundle(bundle);
      setPayloadRetrievedClient(bundle);
      pushStep("Payload Encryption", "saveLocalBundle", { id }, { stored: "client-indexeddb" });

      const serverStore = await fetch("/api/e2ee-blobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bundle }),
      });

      const serverPayload = (await serverStore.json()) as unknown;
      setPayloadRetrievedServer(serverPayload);
      pushStep("Payload Encryption", "POST /api/e2ee-blobs", { id }, serverPayload);

      if (!serverStore.ok) {
        throw new Error("Server store failed");
      }

      setLatestBundleId(id);
      setPayloadStatus("Payload encrypted and stored in both client storage and server storage.");
    } catch (error) {
      setPayloadStatus(error instanceof Error ? error.message : "Encryption failed");
    } finally {
      setBusy(false);
    }
  }

  async function decryptPayloadFromClientStore() {
    setBusy(true);
    setPayloadStatus("");

    try {
      if (!masterKeyRef.current) {
        setPayloadStatus("Unlock key first.");
        return;
      }

      const local = await listLocalBundles();
      const bundle = local.find((item) => item.id === latestBundleId) ?? local[0] ?? null;
      setPayloadRetrievedClient(bundle);
      pushStep("Payload Encryption", "listLocalBundles", { requestedId: latestBundleId }, { count: local.length, found: !!bundle });

      if (!bundle) {
        throw new Error("No local encrypted payload found.");
      }

      const dek = await unwrapDekWithMasterKey(bundle.wrappedDekB64, bundle.wrapIvB64, masterKeyRef.current);
      pushStep("Payload Encryption", "unwrapDekWithMasterKey", { source: "client-indexeddb", id: bundle.id }, { ok: true });

      const plaintext = await decryptWithDek(bundle.ciphertextB64, bundle.contentIvB64, dek, bundle.aadB64);
      setPayloadPlaintext(plaintext);
      pushStep("Payload Encryption", "decryptWithDek", { source: "client-indexeddb", id: bundle.id }, { plaintext });

      setPayloadStatus("Recovered plaintext from client storage bundle.");
    } catch (error) {
      setPayloadStatus(error instanceof Error ? error.message : "Client decrypt failed");
    } finally {
      setBusy(false);
    }
  }

  async function decryptPayloadFromServerStore() {
    setBusy(true);
    setPayloadStatus("");

    try {
      if (!masterKeyRef.current || !latestBundleId) {
        setPayloadStatus("Unlock key and encrypt/store once first.");
        return;
      }

      const response = await fetch(`/api/e2ee-blobs?id=${encodeURIComponent(latestBundleId)}`);
      const payload = (await response.json()) as { bundle?: EnvelopeBundle; message?: string };
      setPayloadRetrievedServer(payload.bundle ?? payload);
      pushStep("Payload Encryption", "GET /api/e2ee-blobs", { id: latestBundleId }, payload);

      if (!response.ok || !payload.bundle) {
        throw new Error(payload.message ?? "Server retrieval failed");
      }

      const dek = await unwrapDekWithMasterKey(payload.bundle.wrappedDekB64, payload.bundle.wrapIvB64, masterKeyRef.current);
      pushStep("Payload Encryption", "unwrapDekWithMasterKey", { source: "server", id: payload.bundle.id }, { ok: true });

      const plaintext = await decryptWithDek(
        payload.bundle.ciphertextB64,
        payload.bundle.contentIvB64,
        dek,
        payload.bundle.aadB64,
      );
      setPayloadPlaintext(plaintext);
      pushStep("Payload Encryption", "decryptWithDek", { source: "server", id: payload.bundle.id }, { plaintext });

      setPayloadStatus("Recovered plaintext from server-retrieved encrypted bundle.");
    } catch (error) {
      setPayloadStatus(error instanceof Error ? error.message : "Server decrypt failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateAndPublishMessagingKey() {
    setBusy(true);
    setMessageStatus("");
    setKeyStatus("");

    try {
      ensureE2EERuntimeOrThrow();

      const existingRing = await getLocalDeviceKeyRing(sessionUser.id);
      const deviceId = getOrCreateDeviceId(sessionUser.id);
      let ring: LocalDeviceKeyRing;

      if (!existingRing || existingRing.keys.length === 0) {
        const first = await createLocalKeyMaterial(sessionUser.id, 1);
        ring = {
          userId: sessionUser.id,
          deviceId,
          algorithm: "X25519",
          activeKeyId: first.keyId,
          keys: [first],
          updatedAt: new Date().toISOString(),
        };
        pushStep("E2EE Messaging", "createLocalKeyMaterial", { userId: sessionUser.id, keyVersion: 1 }, first);
      } else {
        ring = { ...existingRing, deviceId };
      }

      await saveLocalDeviceKeyRing(ring);
      const active = ring.keys.find((key) => key.keyId === ring.activeKeyId) ?? ring.keys[0];
      setMsgRetrievedClient({ keyRing: ring, activeKey: active });
      pushStep("E2EE Messaging", "saveLocalDeviceKeyRing", { userId: sessionUser.id }, { activeKeyId: ring.activeKeyId, count: ring.keys.length });

      const publish = await fetch("/api/e2ee-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityPublicB64: active.identityPublicB64, algorithm: active.algorithm, deviceId }),
      });
      const publishPayload = (await publish.json()) as unknown;
      setMsgRetrievedServer({ publishedPublicKey: publishPayload });
      pushStep("E2EE Messaging", "POST /api/e2ee-keys", { algorithm: active.algorithm }, publishPayload);

      if (!publish.ok) {
        throw new Error("Public key publish failed.");
      }

      setMessageStatus("Active public key published. Existing key ring is kept locally for decrypting historical messages.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Key publish failed.";
      setMessageStatus(reason);
      setMsgRetrievedClient({
        stage: "ensure-key",
        error: reason,
        diagnostics: runtimeDiagnostics,
      });
    } finally {
      setBusy(false);
    }
  }

  async function rotateActiveMessagingKey() {
    setBusy(true);
    setMessageStatus("");
    setKeyStatus("");

    try {
      ensureE2EERuntimeOrThrow();

      const existingRing = await getLocalDeviceKeyRing(sessionUser.id);
      const deviceId = getOrCreateDeviceId(sessionUser.id);
      const nextVersion = existingRing && existingRing.keys.length > 0 ? Math.max(...existingRing.keys.map((key) => key.keyVersion)) + 1 : 1;
      const rotated = await createLocalKeyMaterial(sessionUser.id, nextVersion);

      const ring: LocalDeviceKeyRing = existingRing
        ? {
            ...existingRing,
            deviceId,
            activeKeyId: rotated.keyId,
            keys: [...existingRing.keys, rotated],
            updatedAt: new Date().toISOString(),
          }
        : {
            userId: sessionUser.id,
            deviceId,
            algorithm: "X25519",
            activeKeyId: rotated.keyId,
            keys: [rotated],
            updatedAt: new Date().toISOString(),
          };

      await saveLocalDeviceKeyRing(ring);
      setMsgRetrievedClient({ keyRingAfterRotation: ring, newActive: rotated });
      pushStep("E2EE Messaging", "rotateActiveMessagingKey", { nextVersion }, { newKeyId: rotated.keyId, totalKeys: ring.keys.length });

      const publish = await fetch("/api/e2ee-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identityPublicB64: rotated.identityPublicB64, algorithm: rotated.algorithm, deviceId }),
      });
      const publishPayload = (await publish.json()) as unknown;
      setMsgRetrievedServer({ publishedRotatedPublicKey: publishPayload });
      pushStep("E2EE Messaging", "POST /api/e2ee-keys (rotated)", { keyId: rotated.keyId }, publishPayload);

      if (!publish.ok) {
        throw new Error("Failed to publish rotated key.");
      }

      setKeyStatus(
        "Key rotated. New outgoing messages use the new active key, while old keys remain local decrypt-only so prior messages stay readable on this device.",
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Key rotation failed.";
      setKeyStatus(reason);
      setMsgRetrievedClient({
        stage: "rotate-key",
        error: reason,
        diagnostics: runtimeDiagnostics,
      });
    } finally {
      setBusy(false);
    }
  }

  async function refreshInbox() {
    setBusy(true);
    setMessageStatus("");

    try {
      const response = await fetch("/api/messages");
      const payload = (await response.json()) as { messages?: MessageRecord[]; message?: string };
      setMsgRetrievedServer({ inboxResponse: payload });
      pushStep("E2EE Messaging", "GET /api/messages", {}, payload);

      if (!response.ok) {
        throw new Error(payload.message ?? "Failed to read inbox");
      }

      setInbox(payload.messages ?? []);
      setMessageStatus("Inbox refreshed from server.");
    } catch (error) {
      setMessageStatus(error instanceof Error ? error.message : "Inbox refresh failed.");
    } finally {
      setBusy(false);
    }
  }

  async function sendE2EEMessageByEmail() {
    setBusy(true);
    setMessageStatus("");

    try {
      ensureE2EERuntimeOrThrow();

      const targetEmail = recipientEmail.trim().toLowerCase();
      if (!targetEmail || !messageInput.trim()) {
        setMessageStatus("recipient email and message are required.");
        return;
      }

      const ring = await getLocalDeviceKeyRing(sessionUser.id);
      const local = ring?.keys.find((key) => key.keyId === ring.activeKeyId) ?? (await getLocalDeviceKey(sessionUser.id));
      const deviceId = getOrCreateDeviceId(sessionUser.id);
      setMsgRetrievedClient({ senderKeyRingFromClientStorage: ring, senderActiveKey: local });
      pushStep("E2EE Messaging", "getLocalDeviceKeyRing", { userId: sessionUser.id }, { found: !!ring, keyCount: ring?.keys.length ?? 0 });

      if (!local) {
        throw new Error("Generate/publish your local key first.");
      }

      const keyLookupResponse = await fetch(`/api/e2ee-keys?email=${encodeURIComponent(targetEmail)}`);
      const recipientLookup = (await keyLookupResponse.json()) as {
        user?: { id: string; email: string; username: string };
        publicKeys?: DirectoryPublicKey[];
        message?: string;
      };
      setMsgRetrievedServer({ recipientLookup });
      pushStep("E2EE Messaging", "GET /api/e2ee-keys?email=...", { email: targetEmail }, recipientLookup);

      if (!keyLookupResponse.ok || !recipientLookup.publicKeys || recipientLookup.publicKeys.length === 0) {
        throw new Error(recipientLookup.message ?? "Recipient has no published public key.");
      }

      const ownKeysResponse = await fetch("/api/e2ee-keys");
      const ownKeysPayload = (await ownKeysResponse.json()) as { publicKeys?: DirectoryPublicKey[]; message?: string };
      if (!ownKeysResponse.ok || !ownKeysPayload.publicKeys || ownKeysPayload.publicKeys.length === 0) {
        throw new Error("Failed to load sender device keys from server directory.");
      }
      pushStep("E2EE Messaging", "GET /api/e2ee-keys", { scope: "self" }, ownKeysPayload);

      const senderPrivate = await importX25519PrivateKey(local.identityPrivatePkcs8B64);

      const recipientCopies: E2EECopy[] = [];
      for (const recipientDevice of recipientLookup.publicKeys) {
        const recipientPublic = await importX25519PublicKey(recipientDevice.identityPublicB64);
        const recipientSharedSecret = await deriveSharedSecretB64(senderPrivate, recipientPublic);
        const recipientMessageKey = await deriveMessageKeyB64(recipientSharedSecret);
        const recipientEncrypted = await encryptRatchetMessage(messageInput, recipientMessageKey);

        recipientCopies.push({
          forUserId: recipientLookup.user?.id ?? "",
          deviceId: recipientDevice.deviceId,
          keyId: recipientDevice.keyId,
          keyVersion: recipientDevice.keyVersion,
          ciphertextB64: recipientEncrypted.ciphertextB64,
          ivB64: recipientEncrypted.ivB64,
        });
      }

      const senderCopies: E2EECopy[] = [];
      for (const senderDevice of ownKeysPayload.publicKeys) {
        const senderTargetPublic = await importX25519PublicKey(senderDevice.identityPublicB64);
        const senderSharedSecret = await deriveSharedSecretB64(senderPrivate, senderTargetPublic);
        const senderMessageKey = await deriveMessageKeyB64(senderSharedSecret);
        const senderEncrypted = await encryptRatchetMessage(messageInput, senderMessageKey);

        senderCopies.push({
          forUserId: sessionUser.id,
          deviceId: senderDevice.deviceId,
          keyId: senderDevice.keyId,
          keyVersion: senderDevice.keyVersion,
          ciphertextB64: senderEncrypted.ciphertextB64,
          ivB64: senderEncrypted.ivB64,
        });
      }

      const packet: E2EEPacketV3 = {
        version: "email-e2ee-v3",
        algorithm: "X25519+AES-256-GCM",
        senderUserId: sessionUser.id,
        recipientUserId: recipientLookup.user?.id ?? "",
        senderEmail: sessionUser.email ?? "unknown@local",
        recipientEmail: targetEmail,
        senderPublicB64: local.identityPublicB64,
        senderDeviceId: deviceId,
        senderKeyId: local.keyId,
        senderKeyVersion: `v${local.keyVersion}`,
        createdAt: new Date().toISOString(),
        copies: {
          recipient: recipientCopies,
          sender: senderCopies,
        },
      };
      pushStep(
        "E2EE Messaging",
        "encryptFanOutCopies",
        { plaintext: messageInput, senderKeyId: local.keyId, recipientCopies: recipientCopies.length, senderCopies: senderCopies.length },
        packet,
      );

      const saveResponse = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipientEmail: targetEmail, content: JSON.stringify(packet) }),
      });
      const savePayload = (await saveResponse.json()) as { message?: MessageRecord; messageText?: string; error?: string };
      setMsgRetrievedServer({ messageWriteResponse: savePayload });
      pushStep("E2EE Messaging", "POST /api/messages", { recipientEmail: targetEmail }, savePayload);

      if (!saveResponse.ok) {
        throw new Error("Failed to send encrypted message.");
      }

      setMessageInput("");
      setMessageStatus("Encrypted message sent using recipient email lookup.");
      await refreshInbox();
    } catch (error) {
      setMessageStatus(error instanceof Error ? error.message : "Send failed.");
    } finally {
      setBusy(false);
    }
  }

  async function decryptMessage(message: MessageRecord) {
    setBusy(true);
    setMessageStatus("");
    setDecryptErrors((prev) => {
      const next = { ...prev };
      delete next[message.id];
      return next;
    });

    try {
      ensureE2EERuntimeOrThrow();

      const packet = parsePacket(message.content);
      setMsgRetrievedServer({ selectedMessageFromServer: message, parsedPacket: packet });
      pushStep("E2EE Messaging", "parsePacket(message.content)", { messageId: message.id }, { packetValid: !!packet });

      if (!packet) {
        throw new Error("Message content is not an E2EE packet.");
      }

      const ring = await getLocalDeviceKeyRing(sessionUser.id);
      setMsgRetrievedClient({ receiverKeyRingFromClientStorage: ring });
      pushStep("E2EE Messaging", "getLocalDeviceKeyRing", { userId: sessionUser.id }, { found: !!ring, keyCount: ring?.keys.length ?? 0 });

      if (!ring || ring.keys.length === 0) {
        throw new Error("No local private key available for this account.");
      }

      let plaintext = "";

      if (packet.version === "email-e2ee-v2") {
        const isRecipient = message.recipientId === sessionUser.id;
        const targetCopy = isRecipient ? packet.copies.recipient : packet.copies.sender;
        const localKey = ring.keys.find((key) => key.keyId === targetCopy.keyId);

        if (!localKey) {
          throw new Error(
            `Missing local key ${targetCopy.keyId}. Historical messages require old keys in your local key ring.`,
          );
        }

        const localPrivate = await importX25519PrivateKey(localKey.identityPrivatePkcs8B64);
        const peerPublic = await importX25519PublicKey(packet.senderPublicB64);
        const sharedSecretB64 = await deriveSharedSecretB64(localPrivate, peerPublic);
        pushStep("E2EE Messaging", "deriveSharedSecretB64", { localKeyId: localKey.keyId, packetVersion: packet.version }, { sharedSecretB64 });

        const messageKeyB64 = await deriveMessageKeyB64(sharedSecretB64);
        pushStep("E2EE Messaging", "deriveMessageKeyB64", { source: "sharedSecret", keyId: localKey.keyId }, { messageKeyB64 });

        plaintext = await decryptRatchetMessage(targetCopy.ciphertextB64, targetCopy.ivB64, messageKeyB64);
      } else if (packet.version === "email-e2ee-v3") {
        const isRecipient = message.recipientId === sessionUser.id;
        const allDirectionalCopies = isRecipient ? packet.copies.recipient : packet.copies.sender;
        const candidateCopies = allDirectionalCopies.filter((copy) => copy.forUserId === sessionUser.id);
        const activeKeyId = ring.activeKeyId;
        const localKeySet = new Set(ring.keys.map((key) => key.keyId));
        const currentDeviceId = getOrCreateDeviceId(sessionUser.id);

        if (candidateCopies.length === 0) {
          throw new Error("No encrypted copy exists for this user in the packet.");
        }

        const failureReasons: string[] = [];
        let decrypted = false;

        // Deterministic selection order: exact device+active key, device-local keys, then any matching key-id.
        const prioritizedCopies = [
          ...candidateCopies.filter((copy) => copy.deviceId === currentDeviceId && copy.keyId === activeKeyId),
          ...candidateCopies.filter((copy) => copy.deviceId === currentDeviceId && localKeySet.has(copy.keyId)),
          ...candidateCopies.filter((copy) => copy.deviceId !== currentDeviceId && copy.keyId === activeKeyId),
          ...candidateCopies.filter((copy) => copy.deviceId !== currentDeviceId && localKeySet.has(copy.keyId)),
        ];
        const uniquePrioritizedCopies = prioritizedCopies.filter(
          (copy, idx, arr) => arr.findIndex((c) => c.deviceId === copy.deviceId && c.keyId === copy.keyId) === idx,
        );

        for (const copy of uniquePrioritizedCopies) {
          const localKey = ring.keys.find((key) => key.keyId === copy.keyId);
          if (!localKey) {
            continue;
          }

          try {
            const localPrivate = await importX25519PrivateKey(localKey.identityPrivatePkcs8B64);
            const peerPublic = await importX25519PublicKey(packet.senderPublicB64);
            const sharedSecretB64 = await deriveSharedSecretB64(localPrivate, peerPublic);
            const messageKeyB64 = await deriveMessageKeyB64(sharedSecretB64);
            plaintext = await decryptRatchetMessage(copy.ciphertextB64, copy.ivB64, messageKeyB64);
            decrypted = true;
            break;
          } catch (error) {
            failureReasons.push(
              `copy ${copy.keyId} failed: ${error instanceof Error ? error.message : "decrypt error"}`,
            );
          }
        }

        if (!decrypted) {
          const localKeyIds = ring.keys.map((key) => key.keyId);
          const copyKeyIds = candidateCopies.map((copy) => copy.keyId);
          throw new Error(
            `No decryptable copy found. Local keys: [${localKeyIds.join(", ")}], packet copy keys: [${copyKeyIds.join(", ")}]. ${failureReasons.slice(0, 2).join(" | ")}`,
          );
        }
      } else {
        const activeKey = ring.keys.find((key) => key.keyId === ring.activeKeyId) ?? ring.keys[0];
        const receiverPrivate = await importX25519PrivateKey(activeKey.identityPrivatePkcs8B64);
        const senderPublic = await importX25519PublicKey(packet.senderPublicB64);
        const sharedSecretB64 = await deriveSharedSecretB64(receiverPrivate, senderPublic);
        const messageKeyB64 = await deriveMessageKeyB64(sharedSecretB64);
        plaintext = await decryptRatchetMessage(packet.ciphertextB64, packet.ivB64, messageKeyB64);
      }

      pushStep("E2EE Messaging", "decryptPacketToPlaintext", { messageId: message.id, packetVersion: packet.version }, { plaintext });

      setDecryptedInbox((prev) => ({ ...prev, [message.id]: plaintext }));
      setMessageStatus("Ciphertext decrypted to plaintext using local private key.");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Decrypt failed.";
      setMessageStatus(reason);
      setMsgRetrievedClient({
        previous: msgRetrievedClient,
        stage: "decrypt",
        error: reason,
        diagnostics: runtimeDiagnostics,
      });
      setDecryptErrors((prev) => ({ ...prev, [message.id]: reason }));
    } finally {
      setBusy(false);
    }
  }

  async function resetDemoData() {
    setBusy(true);
    setPayloadStatus("");
    setMessageStatus("");

    try {
      masterKeyRef.current = null;
      setUnlockMeta(null);
      setPayloadPlaintext("");
      setPayloadRetrievedClient(null);
      setPayloadRetrievedServer(null);
      setMsgRetrievedClient(null);
      setMsgRetrievedServer(null);
      setInbox([]);
      setDecryptedInbox({});
      setDecryptErrors({});
      setSteps([]);
      setLatestBundleId(null);

      await clearLocalBundles();
      await clearLocalDeviceKey(sessionUser.id);
      await fetch("/api/e2ee-blobs", { method: "DELETE" });

      pushStep("General", "resetDemoData", { userId: sessionUser.id }, { ok: true });
    } catch {
      setMessageStatus("Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
      <header className="rounded-xl border border-slate-300 bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold text-slate-900 md:text-3xl">Client Payload Encryption + Email E2EE Messaging</h1>
        <p className="mt-2 text-sm text-slate-700">
          This demo shows exactly what is retrieved from client storage, what is retrieved from server storage, and each
          operation until plaintext is recovered.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Authenticated user</p>
            <JsonBox value={sessionUser} />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Payload unlock state</p>
            <JsonBox value={unlockSummary} />
          </div>
        </div>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        {([
          ["payload", "1) Payload Client Encryption"],
          ["messaging", "2) Email E2EE Messaging"],
          ["trace", "3) End-to-End Trace"],
        ] as Array<[DemoTab, string]>).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-md px-3 py-2 text-sm font-semibold ${
              activeTab === tab ? "bg-slate-900 text-white" : "border border-slate-400 bg-white text-slate-900"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {activeTab === "payload" ? (
          <Section title="Payload Encryption Demo">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="payload-password">
                  Unlock password
                </label>
                <input
                  id="payload-password"
                  type="password"
                  value={payloadPassword}
                  onChange={(event) => setPayloadPassword(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="payload-label">
                  Payload label
                </label>
                <input
                  id="payload-label"
                  value={payloadLabel}
                  onChange={(event) => setPayloadLabel(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="payload-input">
                Given payload
              </label>
              <textarea
                id="payload-input"
                value={payloadInput}
                onChange={(event) => setPayloadInput(event.target.value)}
                className="h-28 w-full rounded-md border border-slate-300 px-3 py-2"
              />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={unlockPayloadKey}
                className="rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white"
              >
                Unlock Key
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={encryptPayloadAndStore}
                className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                Encrypt and Store (Client + Server)
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={decryptPayloadFromClientStore}
                className="rounded-md border border-slate-400 px-4 py-2 disabled:opacity-60"
              >
                Retrieve Client Bundle {"->"} Plaintext
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={decryptPayloadFromServerStore}
                className="rounded-md border border-slate-400 px-4 py-2 disabled:opacity-60"
              >
                Retrieve Server Bundle {"->"} Plaintext
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div>
                <p className="mb-1 text-sm font-semibold text-slate-900">Retrieved from client storage</p>
                <JsonBox value={payloadRetrievedClient} />
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-slate-900">Retrieved from server</p>
                <JsonBox value={payloadRetrievedServer} />
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-slate-900">Plaintext result</p>
                <JsonBox value={payloadPlaintext || "No plaintext recovered yet."} />
              </div>
            </div>

            {payloadStatus ? <p className="mt-3 text-sm text-slate-800">{payloadStatus}</p> : null}
          </Section>
        ) : null}

        {activeTab === "messaging" ? (
          <Section title="Email-Based E2EE Messaging Demo">
            <p className="mb-3 text-sm text-slate-700">
              Flow: local private key from client storage + recipient public key from server directory by email {"->"} derive
              shared secret {"->"} encrypt {"->"} store ciphertext on server {"->"} retrieve and decrypt to plaintext.
            </p>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={generateAndPublishMessagingKey}
                className="rounded-md bg-slate-900 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                Ensure Local Key + Publish Active Public Key
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={rotateActiveMessagingKey}
                className="rounded-md border border-amber-500 px-4 py-2 font-semibold text-amber-700 disabled:opacity-60"
              >
                Rotate Active Key (Keep Old Decrypt-Only Keys)
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={refreshInbox}
                className="rounded-md border border-slate-400 px-4 py-2 disabled:opacity-60"
              >
                Refresh Inbox from Server
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="recipient-email">
                  Recipient email
                </label>
                <input
                  id="recipient-email"
                  type="email"
                  value={recipientEmail}
                  onChange={(event) => setRecipientEmail(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                  placeholder="user@example.com"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-900" htmlFor="message-body">
                  Plaintext to encrypt
                </label>
                <input
                  id="message-body"
                  value={messageInput}
                  onChange={(event) => setMessageInput(event.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={sendE2EEMessageByEmail}
                className="rounded-md bg-emerald-700 px-4 py-2 font-semibold text-white disabled:opacity-60"
              >
                Encrypt and Send by Email
              </button>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              <div>
                <p className="mb-1 text-sm font-semibold text-slate-900">Retrieved from client storage</p>
                <JsonBox value={msgRetrievedClient} />
                <p className="mt-2 mb-1 text-xs font-semibold uppercase tracking-wide text-slate-600">Runtime diagnostics</p>
                <JsonBox value={runtimeDiagnostics} />
              </div>
              <div>
                <p className="mb-1 text-sm font-semibold text-slate-900">Retrieved from server</p>
                <JsonBox value={msgRetrievedServer} />
              </div>
            </div>

            <div className="mt-4 space-y-2">
              <h3 className="text-sm font-semibold text-slate-900">Inbox ciphertext and plaintext results</h3>
              {inbox.length === 0 ? <p className="text-sm text-slate-600">No messages found.</p> : null}
              {inbox.map((message) => (
                <article key={message.id} className="rounded-md border border-slate-200 p-3 text-sm">
                  <p className="font-semibold text-slate-900">
                    {message.senderId === sessionUser.id ? "Sent" : "Received"} | {new Date(message.createdAt).toLocaleString()}
                  </p>
                  <p className="text-slate-700">From: {message.sender.email}</p>
                  <p className="text-slate-700">To: {message.recipient.email}</p>
                  <p className="mt-2 text-xs text-slate-600">Server ciphertext payload</p>
                  <JsonBox value={parsePacket(message.content) ?? message.content} />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void decryptMessage(message)}
                      className="rounded-md border border-slate-400 px-3 py-1.5 text-xs font-semibold text-slate-900 disabled:opacity-60"
                    >
                      Decrypt to Plaintext
                    </button>
                  </div>
                  <p className="mt-2 text-xs text-slate-600">Plaintext result</p>
                  <JsonBox value={decryptedInbox[message.id] ?? "Not decrypted yet"} />
                  {decryptErrors[message.id] ? (
                    <p className="mt-2 rounded-md bg-red-50 p-2 text-xs text-red-700">Decrypt failed: {decryptErrors[message.id]}</p>
                  ) : null}
                </article>
              ))}
            </div>

            {messageStatus ? <p className="mt-3 text-sm text-slate-800">{messageStatus}</p> : null}
            {keyStatus ? <p className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-800">{keyStatus}</p> : null}
          </Section>
        ) : null}

        {activeTab === "trace" ? (
          <Section title="Step-by-Step Trace (Server Retrieval, Client Retrieval, Crypto Operations)">
            <p className="mb-2 text-xs text-slate-600">
              This log records the function inputs/outputs used to move from encrypted payloads to plaintext.
            </p>
            <JsonBox value={steps} />
          </Section>
        ) : null}

        <Section title="Reset and Session Controls">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={resetDemoData}
              className="rounded-md border border-red-400 px-4 py-2 text-red-700 disabled:opacity-60"
            >
              Reset Local and Server Demo Data
            </button>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/demo-login" })}
              className="rounded-md border border-slate-400 px-4 py-2 text-slate-900"
            >
              Sign Out
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
