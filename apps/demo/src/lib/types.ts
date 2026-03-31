// Shared domain types used by UI, anonymization logic, and API payloads.
export type EntityType =
  | "name"
  | "email"
  | "phone"
  | "date"
  | "location"
  | "organization"
  | "id"
  | "other";

export type SensitiveEntity = {
  // Random client-side ID for stable rendering/debugging.
  id: string;
  type: EntityType;
  value: string;
};

export type MapEntry = {
  // One reversible replacement decision.
  type: EntityType;
  real: string;
  fake: string;
};

export type PipelineResult = {
  method: string;
  original: string;
  detectedEntities: SensitiveEntity[];
  replacementDecisions: MapEntry[];
  anonymized: string;
  deanonymized: string;
};

export type EncryptedPayload = {
  // Stored as strings so it can be transported over JSON safely.
  algorithm: "AES-GCM";
  iterations: number;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
};
