/**
 * Generates a lightweight browser device identifier.
 * Security note: this is not an authentication factor.
 */
export function getDeviceId(userId: string): string {
  if (typeof window === "undefined") {
    return `server-${userId.slice(0, 8)}`;
  }

  const storageKey = `harrison:e2ee:device:${userId}`;
  const existing = window.localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }

  const created = `web-${Math.random().toString(16).slice(2, 10)}`;
  window.localStorage.setItem(storageKey, created);
  return created;
}
