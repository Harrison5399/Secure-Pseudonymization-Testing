export type DeriveMasterKeyResult = {
  masterKey: CryptoKey;
  saltB64: string;
  iterations: number;
  // Demo-only display material so learners can inspect outputs.
  // In production, avoid exposing key material in UI logs.
  derivedKeyB64: string;
};

export type EnvelopeBundle = {
  id: string;
  userId: string;
  algorithm: "AES-256-GCM";
  encryptedAt: string;
  ciphertextB64: string;
  contentIvB64: string;
  wrappedDekB64: string;
  wrapIvB64: string;
  // AAD is optional and binds context to ciphertext integrity checks.
  aadB64?: string;
  metadata: {
    version: "client-envelope-v1";
    noteLabel?: string;
    hkdfContext?: string;
  };
};

export type StepRecord = {
  section: string;
  functionName: string;
  inputs: unknown;
  output: unknown;
  at: string;
};

// Legacy demo types still used by the E2EE page signal-simulation section.
export type DeviceKeySet = {
  identityKeyPair: CryptoKeyPair;
  signedPreKeyPair: CryptoKeyPair;
  identityPublicB64: string;
  signedPreKeyPublicB64: string;
};

export type RatchetState = {
  chainKeyB64: string;
};
