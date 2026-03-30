# LLM Anonymization Playground

Educational Next.js app that demonstrates two related privacy workflows:

- LLM anonymization + reversible deanonymization.
- Authenticated client-side encryption and E2EE-inspired messaging concepts.

## What this app includes

### 1) Anonymization demo

- Three anonymization approaches:
	- Pure client-side with LLM detection (Transformers.js with fallback behavior)
	- Pure client-side with regex + lightweight NER (compromise)
	- Hybrid pipeline (client redaction + server-side final pass)
- Reversible Fake <-> Real map generation
- Two map storage modes:
	- IndexedDB only (map never leaves browser)
	- Client-encrypted map blob (AES-256-GCM) stored on backend

### 2) Client-side encryption + E2EE demo

- Auth.js credentials login with Prisma-backed users
- Master key derivation in browser from password
- Envelope encryption demo:
	- Generate DEK
	- Encrypt plaintext with DEK
	- Wrap DEK with master key
	- Store encrypted bundle locally and on backend
- Signal-inspired section (X3DH/double-ratchet style educational flow)
- Multi-user messaging demo using real persisted user IDs

## Security model

### Anonymization storage model

- Trust boundary: browser is trusted for plaintext map handling.
- Backend is treated as untrusted for sensitive plaintext.
- In encrypted backend mode, server stores ciphertext + IV + salt metadata only.
- Decryption key is derived client-side from password + pepper and never uploaded.

### E2EE educational model

- Authentication identifies the user and authorizes access to encrypted blobs.
- Encryption/decryption keys stay client-side while unlocked in memory.
- Server stores encrypted payloads but cannot decrypt without client-derived keys.

## Routes

- `/`: anonymization and map storage demo
- `/demo-login`: login/register page
- `/e2ee-client-side-encryption`: protected client-side encryption + signal-inspired demo
- `/messages`: protected user-to-user messaging demo

## Local setup

1. Install dependencies.

```bash
npm install
```

2. Create `.env`.

```bash
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/DB_NAME?schema=public"
NEXTAUTH_URL="http://localhost:3000"
NEXTAUTH_SECRET="replace-with-a-long-random-secret"
```

3. Sync Prisma schema and generate client.

```bash
npx prisma generate
npx prisma migrate dev --name init
```

If you are in a non-interactive shell or migration prompts are blocked, use:

```bash
npx prisma db push
npx prisma generate
```

4. Start the app.

```bash
npm run dev
```

5. Open `http://localhost:3000`.

Use `localhost` consistently for auth cookies. Avoid switching between `localhost` and LAN IP in the same session.

## HTTPS multi-device testing with Cloudflare Tunnel

E2EE features in this demo rely on browser Web Crypto APIs that often require a secure context on mobile (`https` or `localhost`).
For phone and multi-device testing, use an HTTPS tunnel URL consistently.

### Quick tunnel (fastest to try)

1. Install Cloudflare tunnel client.

```bash
winget install Cloudflare.cloudflared
```

2. Run Next dev server.

```bash
npm run dev
```

3. In a second terminal, start tunnel to local app.

```bash
cloudflared tunnel --url http://localhost:3000
```

4. Copy the generated HTTPS URL (example: `https://something.trycloudflare.com`).

5. Update `.env` to use that exact HTTPS origin.

```bash
NEXTAUTH_URL="https://something.trycloudflare.com"
ALLOWED_DEV_ORIGINS="localhost,192.168.0.3,something.trycloudflare.com"
```

6. Restart the dev server after changing `.env`.

7. Open only the tunnel URL on all devices (desktop + phone) for that session.

### Stable tunnel (recommended for repeated testing)

Quick tunnel URLs change every run. For repeatable auth/cookie testing, use a named tunnel and fixed hostname.

1. Login to Cloudflare in terminal.

```bash
cloudflared tunnel login
```

2. Create a named tunnel.

```bash
cloudflared tunnel create llm-anon-demo
```

3. Route a DNS hostname (for a domain in your Cloudflare account).

```bash
cloudflared tunnel route dns llm-anon-demo demo.yourdomain.com
```

4. Run tunnel to your local app.

```bash
cloudflared tunnel run llm-anon-demo
```

5. Set `.env` with fixed HTTPS host and restart dev server.

```bash
NEXTAUTH_URL="https://demo.yourdomain.com"
ALLOWED_DEV_ORIGINS="localhost,192.168.0.3,demo.yourdomain.com"
```

### Does this work outside your local network?

Yes. Cloudflare tunnel exposes your local app through a public HTTPS URL, so it is reachable from outside your LAN.

Important safety notes for development:

- Anyone with the URL can attempt access unless you add access controls.
- Use strong demo passwords and never use production secrets.
- Prefer Cloudflare Access (or similar) to restrict who can open the tunnel URL.
- Rotate credentials and stop the tunnel when done.

## How to use the demos

## A. Anonymization demo (`/`)

1. Paste or edit text containing names, emails, phone numbers, and organizations.
2. Choose one anonymization method.
3. Click Run and inspect the step-by-step trace.
4. Save the reversible map either:
	 - Locally in IndexedDB, or
	 - As client-encrypted blob on backend.
5. Load map and test deanonymization flow.

## B. Login + E2EE client encryption demo (`/demo-login` -> `/e2ee-client-side-encryption`)

1. Open `/demo-login`.
2. Register a user (username, email, password).
3. Switch to Login and sign in with username or email + password.
4. On `/e2ee-client-side-encryption`:
	 - Unlock session with a password-derived master key.
	 - Encrypt and store a note (envelope encryption path).
	 - Decrypt and view to verify end-to-end round trip.
	 - Compare local stored bundles vs server stored encrypted bundles.
	 - Explore signal-inspired tab for handshake/ratchet style educational steps.

## C. Multi-user messaging demo (`/messages`)

1. Register at least two users.
2. Sign in as user A and open `/messages`.
3. Refresh users, choose recipient user B, and send a message.
4. Sign out, sign in as user B, refresh messages, and verify receipt.
5. Confirm sender/recipient user IDs match persisted database users.

## Troubleshooting

- Redirect loop back to login after successful sign-in:
	- Restart dev server after changing `.env`.
	- Clear site cookies once.
	- Use one host consistently per session (for example, only your tunnel host).
- Mobile E2EE key generation fails with secure-context/WebCrypto errors:
	- Use HTTPS tunnel URL instead of `http://192.168.x.x`.
	- Confirm you are loading the same `NEXTAUTH_URL` host on all devices.
- First LLM anonymization run may be slower because model assets are downloaded.
- If LLM model load fails, fallback detection logic still lets demo run.

## Key files

- `src/app/page.tsx`: main anonymization UI and storage controls
- `src/lib/anonymization.ts`: anonymization and hybrid pipeline logic
- `src/lib/crypto.ts`: map encryption/decryption helpers for anonymization map blobs
- `src/lib/indexeddb.ts`: IndexedDB map storage
- `src/app/demo-login/page.tsx`: login route wrapper
- `src/app/demo-login/DemoLoginForm.tsx`: login/register client form
- `src/lib/auth-options.ts`: Auth.js config and session callbacks
- `src/app/e2ee-client-side-encryption/E2EEClientDemo.tsx`: protected client encryption + signal-inspired UI
- `src/app/api/e2ee-blobs/route.ts`: encrypted blob CRUD for signed-in users
- `src/app/messages/MessagesClient.tsx`: user-to-user messaging UI
- `src/app/api/messages/route.ts`: message read/write APIs tied to authenticated user IDs
- `prisma/schema.prisma`: Prisma models (Auth.js tables, blobs, messages, anonymization data)
