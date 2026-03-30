import { openDB } from "idb";
import type { MapEntry } from "@/lib/types";

// Local-only map storage model for fully client-side mode.
type StoredMap = {
  id: string;
  map: MapEntry[];
  createdAt: string;
};

const DB_NAME = "anonymization-demo";
const STORE = "localMaps";

async function getDb() {
  // Create store once; reuse for all later reads/writes.
  return openDB(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    },
  });
}

export async function saveMapLocally(id: string, map: MapEntry[]): Promise<void> {
  // Caller controls ID so UI can retrieve map by conversation.
  const db = await getDb();
  await db.put(STORE, {
    id,
    map,
    createdAt: new Date().toISOString(),
  } satisfies StoredMap);
}

export async function getLocalMap(id: string): Promise<StoredMap | null> {
  // Null means nothing stored yet for this identifier.
  const db = await getDb();
  return (await db.get(STORE, id)) ?? null;
}
