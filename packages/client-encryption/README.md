# @harrison/client-encryption

Browser-first client-side encryption utilities for educational demos.

## Scope

- Password-based master-key derivation.
- Envelope encryption helpers (DEK generation, wrap, unwrap, encrypt, decrypt).
- Reversible map encryption helpers.
- Local IndexedDB utilities for encrypted bundles and device key rings.

## Install

```bash
npm i @harrison/client-encryption
```

## Quick start (envelope flow)

```ts
import {
	deriveMasterKeyFromPassword,
	generateDataEncryptionKey,
	encryptWithDek,
	wrapDekWithMasterKey,
	unwrapDekWithMasterKey,
	decryptWithDek,
} from "@harrison/client-encryption";

const { masterKey } = await deriveMasterKeyFromPassword("demo-password");
const dek = await generateDataEncryptionKey();
const { ciphertextB64, ivB64 } = await encryptWithDek("secret payload", dek);
const { wrappedDekB64, wrapIvB64 } = await wrapDekWithMasterKey(dek, masterKey);

const unwrapped = await unwrapDekWithMasterKey(wrappedDekB64, wrapIvB64, masterKey);
const plaintext = await decryptWithDek(ciphertextB64, ivB64, unwrapped);
console.log(plaintext);
```

## Quick start (map encryption)

```ts
import { encryptMap, decryptMap } from "@harrison/client-encryption";
import type { MapEntry } from "@harrison/pseudonymization";

const map: MapEntry[] = [{ type: "email", real: "alice@example.com", fake: "user1@example.test" }];
const payload = await encryptMap(map, "password", "pepper");
const decrypted = await decryptMap(payload, "password", "pepper");
```

## Main exports

- Envelope helpers:
	`deriveMasterKeyFromPassword`, `deriveHkdfContextAad`, `generateDataEncryptionKey`,
	`encryptWithDek`, `decryptWithDek`, `wrapDekWithMasterKey`, `unwrapDekWithMasterKey`,
	`buildEnvelopeBundle`
- Map helpers:
	`encryptMap`, `decryptMap`
- Encoding helpers:
	`bytesToBase64`, `base64ToBytes`, `utf8ToBytes`, `toArrayBuffer`
- Storage helpers:
	`saveLocalBundle`, `listLocalBundles`, `clearLocalBundles`,
	`saveLocalDeviceKeyRing`, `getLocalDeviceKeyRing`, `saveLocalDeviceKey`, `getLocalDeviceKey`,
	`clearLocalDeviceKey`, `saveEncryptedItem`

## Security notes

- Keys should remain client-side and never be uploaded.
- This package is educational; perform independent review for production use.
- JavaScript memory wiping is best-effort only.

## Development

```bash
npm run typecheck -w @harrison/client-encryption
npm run lint -w @harrison/client-encryption
npm run build -w @harrison/client-encryption
```
