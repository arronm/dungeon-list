# Twitch Extension Setup

This project is a Twitch Component Extension with a separate Extension Backend Service (EBS).

## Twitch Developer Console

Create a new Extension in the Twitch Developer Console:

- Type: **Component**
- Viewer path: `/index.html`
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

## Security Model

- Every `/api/*` request must include `Authorization: Bearer <extension-jwt>`.
- The EBS verifies the Extension JWT signature and expiration using the shared extension secret.
- Viewers must share identity before joining so the queue can maintain one active entry per Twitch user per channel.
- Broadcaster and moderator actions are allowed only when the verified token role is `broadcaster` or `moderator`.
- PubSub messages are signed by the EBS with an `external` role JWT and only send a compact invalidation event; clients refetch the queue from the API.

## Future Key Volunteering

The v1 queue stores role and optional note only. A future key-volunteering feature should add a nullable structured key offer to queue entries, then expose dungeon, level, and availability controls in the signup form. The existing per-channel queue and moderation endpoints can remain the authority for ordering and status changes.
