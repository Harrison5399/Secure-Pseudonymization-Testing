# @harrison/e2ee

Educational E2EE helpers and simulation utilities for browser demos.

## Scope

- Device identity helpers (`getDeviceId`).
- Fan-out message-shape helper (`encryptForDevices` placeholder).
- libsignal-based session simulation helpers.
- X25519 shared-secret and AES-GCM ratchet-style message utilities.

## Install

```bash
npm i @harrison/e2ee
```

## Quick start (simulation flow)

```ts
import {
	createSignalClient,
	establishSessionFromPreKey,
	encryptSignalMessage,
	decryptSignalMessage,
} from "@harrison/e2ee";

const alice = await createSignalClient("alice", 1);
const bob = await createSignalClient("bob", 1);

await establishSessionFromPreKey(alice, bob);
const packet = await encryptSignalMessage(alice, bob, "hello");
const plaintext = await decryptSignalMessage(bob, alice, packet);
console.log(plaintext);
```

## Main exports

- Device/message helpers:
	`getDeviceId`, `encryptForDevices`
- Signal simulation:
	`createSignalClient`, `establishSessionFromPreKey`, `encryptSignalMessage`,
	`decryptSignalMessage`, `hasOpenSession`
- X25519 and ratchet helpers:
	`generateDeviceKeys`, `importX25519PublicKey`, `importX25519PrivateKey`,
	`deriveSharedSecretB64`, `ratchetStep`, `encryptRatchetMessage`, `decryptRatchetMessage`
- Encoding helpers:
	`bytesToBase64`, `base64ToBytes`, `utf8ToBytes`, `toArrayBuffer`

## Security notes

- Intended for education and protocol exploration.
- Not audited for production deployment.
- Use only as demo scaffolding unless independently reviewed.

## Development

```bash
npm run typecheck -w @harrison/e2ee
npm run lint -w @harrison/e2ee
npm run build -w @harrison/e2ee
```
