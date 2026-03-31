export type DevicePublicKey = {
  deviceId: string;
  keyId: string;
  publicKeyB64: string;
};

export type EncryptedMessageCopy = {
  forUserId: string;
  deviceId: string;
  keyId: string;
  ciphertextB64: string;
  ivB64: string;
};

export type DeviceKeySet = {
  identityKeyPair: CryptoKeyPair;
  signedPreKeyPair: CryptoKeyPair;
  identityPublicB64: string;
  signedPreKeyPublicB64: string;
};

export type RatchetState = {
  chainKeyB64: string;
};
