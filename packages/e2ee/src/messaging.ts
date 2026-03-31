import type { DevicePublicKey, EncryptedMessageCopy } from "./types";

/**
 * Encrypts message content into recipient/sender fan-out copies.
 * Security note: this placeholder API defines shape, while concrete crypto wiring
 * is integrated during app migration.
 */
export async function encryptForDevices(
  plaintext: string,
  recipients: DevicePublicKey[],
  senderDevices: DevicePublicKey[],
): Promise<{ recipientCopies: EncryptedMessageCopy[]; senderCopies: EncryptedMessageCopy[] }> {
  void plaintext;
  return {
    recipientCopies: recipients.map((device) => ({
      forUserId: "",
      deviceId: device.deviceId,
      keyId: device.keyId,
      ciphertextB64: "",
      ivB64: "",
    })),
    senderCopies: senderDevices.map((device) => ({
      forUserId: "",
      deviceId: device.deviceId,
      keyId: device.keyId,
      ciphertextB64: "",
      ivB64: "",
    })),
  };
}
