# Twitch Extension Setup

This project is a Twitch Component Extension with a separate Extension Backend Service (EBS).

## Twitch Developer Console

Create a new Extension in the Twitch Developer Console:

- Type: **Component**
- Video - Component viewer path: `index.html`
- Autoscale: **Disabled** (the UI is responsive; a fixed Scale Pixels value shrinks it)
- Backend URL allowlist: the public HTTPS origin for the EBS
- Local test base URI: the HTTPS URL that serves `apps/extension`
- OAuth redirect URL: not required for v1

The frontend loads Twitch's Extension Helper from:

```text
https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js
```

## Environment

Copy `.env.example` to `.env` and fill in:

```bash
TWITCH_EXTENSION_CLIENT_ID=
TWITCH_EXTENSION_SECRET=
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dungeon_list
VITE_EBS_BASE_URL=https://your-ebs.example.com
```

Use `TWITCH_PUBSUB_ENABLED=false` for local backend testing unless the EBS can reach Twitch and has valid extension credentials.

`TWITCH_EXTENSION_SECRET` must be the base64-encoded extension secret from the Twitch Developer Console. The EBS decodes it before verifying HS256 Extension JWTs.

## Local Development

Install dependencies and generate Prisma:

```bash
npm install
npm run prisma:generate
```

Run the backend:

```bash
npm run dev:ebs
```

Run the extension UI:

```bash
npm run dev:extension
```

For a pure localhost UI/design test, run only the extension frontend and open:

```text
http://localhost:5173
```

When Vite is running outside Twitch, the app automatically uses an in-memory mock queue. No Twitch extension, EBS, or database is required.

Useful mock URLs:

```text
http://localhost:5173/?mockRole=broadcaster
http://localhost:5173/?mockRole=moderator
http://localhost:5173/?mockRole=viewer
http://localhost:5173/?mockRole=viewer&mockLinked=false
http://localhost:5173/?mockTheme=light
```

For real Twitch testing, expose both services over HTTPS and configure the Twitch Extension local test settings to point at the frontend URL. The extension frontend calls the EBS through `VITE_EBS_BASE_URL`, so that URL must also be allowed in the Twitch Extension Console.

## Database

The first migration can be created with:

```bash
npm run prisma:migrate
```

Production deploys should apply committed migrations with:

```bash
npm run prisma:deploy
```

Queue state is stored per broadcaster channel and remains until a broadcaster or moderator clears it.

## Build and Upload

Build all workspaces:

```bash
npm run build
```

Build the Twitch asset zip:

```bash
npm run build:extension-zip
```

The script packages `apps/extension/dist` into `extension-build.zip` at the repository root. Upload that zip in the Twitch Developer Console.

The build reads `VITE_EBS_BASE_URL` from the repository-root `.env` and fails if it is missing. For Hosted Test, it must be the public HTTPS EBS origin.

## Blank Extension Troubleshooting

Inspect the extension's inner iframe with browser DevTools and check its Network and Console tabs:

1. A `404` for `index.html` means the viewer path or ZIP layout is wrong. Use the relative viewer path `index.html`; `index.html` must be at the ZIP root, not inside a directory.
2. A CORS error loading the Local Test `index.html` means the static server is not allowing the Twitch supervisor origin. Use this repository's Vite preview configuration or serve the assets through an HTTPS host that permits `https://supervisor.ext-twitch.tv`.
3. A CSP `connect-src` error means the EBS origin is absent from **Allowlist for URL Fetching Domains**. Add `https://dungeon-list.onrender.com` for the current deployment.
4. A request to the extension's own `/api/queue` means the frontend was built without `VITE_EBS_BASE_URL`. Rebuild and upload `extension-build.zip`.
5. No `onAuthorized` callback or an unavailable `window.Twitch.ext` points to the Twitch Extension Helper being blocked, an invalid test/view context, or a browser extension/privacy setting.
6. A pending or failed request to `https://dungeon-list.onrender.com/health` means the EBS deployment must be restored before queue data can load.

For Local Test, use `http://localhost:5173/` only after enabling Chrome's `chrome://flags/#allow-insecure-localhost` flag and restarting Chrome. The Testing Base URI must end in `/` and the Component viewer path must be `index.html`. Otherwise, serve the frontend through an HTTPS tunnel.

Chrome 142 and newer also require Local Network Access permission when Twitch loads a loopback URL. Allow Twitch's **Local network access** or **Loopback network** permission in Chrome's site settings. An HTTPS tunnel avoids the loopback restriction entirely and is the preferred fallback when the permission is unavailable inside Twitch's nested extension iframe.

## Security Model

- Every `/api/*` request must include `Authorization: Bearer <extension-jwt>`.
- The EBS verifies the Extension JWT signature and expiration using the shared extension secret.
- Viewers must share identity before joining so the queue can maintain one active entry per Twitch user per channel.
- Broadcaster and moderator actions are allowed only when the verified token role is `broadcaster` or `moderator`.
- PubSub messages are signed by the EBS with an `external` role JWT and only send a compact invalidation event; clients refetch the queue from the API.
- Viewer clients also poll every 15 seconds while visible and refresh when the tab regains focus, so queues remain current if PubSub is unavailable.

## Future Key Volunteering

The v1 queue stores role and optional note only. A future key-volunteering feature should add a nullable structured key offer to queue entries, then expose dungeon, level, and availability controls in the signup form. The existing per-channel queue and moderation endpoints can remain the authority for ordering and status changes.
