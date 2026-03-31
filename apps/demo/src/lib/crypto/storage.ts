import { openDB } from "idb";
import type { EnvelopeBundle } from "@/lib/crypto/types";

const DB_NAME = "e2ee-client-demo";
const STORE_NAME = "encryptedBundles";
const KEY_STORE_NAME = "deviceKeys";

export type LocalDeviceKeyMaterial = {
  keyId: string;
  keyVersion: number;
  userId: string;
  algorithm: "X25519";
  identityPublicB64: string;
  identityPrivatePkcs8B64: string;
  createdAt: string;
};

export type LocalDeviceKeyRing = {
  userId: string;
  deviceId?: string;
  algorithm: "X25519";
  activeKeyId: string;
  keys: LocalDeviceKeyMaterial[];
  updatedAt: string;
};

function normalizeRing(raw: unknown, userId: string): LocalDeviceKeyRing | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }

  const value = raw as Partial<LocalDeviceKeyRing>;

  if (Array.isArray(value.keys) && value.keys.length > 0 && typeof value.activeKeyId === "string") {
    return {
      userId,
      deviceId: typeof value.deviceId === "string" ? value.deviceId : undefined,
      algorithm: "X25519",
      activeKeyId: value.activeKeyId,
      keys: value.keys,
      updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date().toISOString(),
    };
  }

  return undefined;
}

async function getDb() {
  return openDB(DB_NAME, 2, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME, { keyPath: "userId" });
      }
    },
  });
}

export async function saveLocalBundle(bundle: EnvelopeBundle): Promise<void> {
  const db = await getDb();
  await db.put(STORE_NAME, bundle);
}

export async function listLocalBundles(): Promise<EnvelopeBundle[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}

export async function clearLocalBundles(): Promise<void> {
  const db = await getDb();
  await db.clear(STORE_NAME);
}

export async function saveLocalDeviceKeyRing(ring: LocalDeviceKeyRing): Promise<void> {
  const db = await getDb();
  await db.put(KEY_STORE_NAME, ring);
}

export async function getLocalDeviceKeyRing(userId: string): Promise<LocalDeviceKeyRing | undefined> {
  const db = await getDb();
  const raw = await db.get(KEY_STORE_NAME, userId);
  return normalizeRing(raw, userId);
}

export async function clearLocalDeviceKey(userId: string): Promise<void> {
  const db = await getDb();
  await db.delete(KEY_STORE_NAME, userId);
}
