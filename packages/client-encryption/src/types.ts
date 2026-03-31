export type WrappedPayload = {
  ciphertextB64: string;
  ivB64: string;
  wrappedDekB64: string;
  wrapIvB64: string;
  saltB64: string;
  iterations: number;
};

export type EncryptOptions = {
  iterations?: number;
  aadB64?: string;
};

export type EncryptedPayload = {
  algorithm: "AES-GCM";
  iterations: number;
  saltB64: string;
  ivB64: string;
  ciphertextB64: string;
};

export type DeriveMasterKeyResult = {
  masterKey: CryptoKey;
  saltB64: string;
  iterations: number;
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
