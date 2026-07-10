# Getting Started

This repo contains a Twitch Component Extension frontend and an Extension Backend Service (EBS) for a dungeon-run waitlist.

## What To Run

Use one of these workflows:

| Goal | Run backend? | Run Twitch? | Best command |
| --- | --- | --- | --- |
| UI/design smoke test | No | No | `npm run dev:extension` |
| Local API/backend development | Yes | No | `npm run dev:ebs` plus API tests |
| Full Twitch Local Test | Yes | Yes | `npm run dev:ebs` and `npm run dev:extension` |
| Hosted Test / release | Hosted EBS | Yes | `npm run build:extension-zip` |

The fastest local workflow is the frontend-only mock. The best realistic workflow is Twitch Local Test with a real EBS, Postgres, and HTTPS tunnel URLs.

## 1. Install

```bash
npm install
npm run prisma:generate
npm run typecheck
npm test
```

## 2. Frontend-Only Local Mock

This is the easiest way to test general interaction and design.

```bash
npm run dev:extension
```

Open the local URL Vite prints, usually:

```text
http://localhost:5173/
```

If that port is occupied, Vite will print another port. The app automatically uses an in-memory mock queue when it is opened as a standalone Vite page.

Useful mock URLs:

```text
/?mockRole=broadcaster
/?mockRole=moderator
/?mockRole=viewer
/?mockRole=viewer&mockLinked=false
/?mockTheme=light
/?mock=false
```

Stop the dev server with `Ctrl+C`.

## 3. Run The Backend Locally

The EBS needs Postgres and Twitch Extension credentials for real Twitch traffic.

Create `.env`:

```bash
cp .env.example .env
```

Fill in:

```bash
TWITCH_EXTENSION_CLIENT_ID=<extension client ID>
TWITCH_EXTENSION_SECRET=<base64 extension secret>
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dungeon_list
PORT=8080
FRONTEND_ORIGIN=http://localhost:5173
TWITCH_PUBSUB_ENABLED=false
VITE_EBS_BASE_URL=http://localhost:8080
```

Start Postgres however you normally run local databases. One common Docker option is:

```bash
docker run --name dungeon-list-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=dungeon_list \
  -p 5432:5432 \
  postgres:16
```

Apply migrations:

```bash
npm run prisma:deploy
```

Start the EBS:

```bash
npm run dev:ebs
```

Health check:

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{"ok":true}
```

## 4. Full Twitch Local Test

Use this when you want real Twitch identity, moderator/broadcaster roles, Extension JWTs, and Twitch iframe behavior.

Recommended setup:

1. Run Postgres and the EBS locally on `localhost:8080`.
2. Expose the EBS with an HTTPS tunnel.
3. Set `VITE_EBS_BASE_URL` to the EBS tunnel URL.
4. Restart `npm run dev:extension`.
5. Configure Twitch Local Test to load the frontend.

Example tunnel layout:

```text
Frontend: https://<frontend-tunnel>/, or http://localhost:5173/ with Chrome's insecure-localhost flag
EBS:      https://<ebs-tunnel>/
```

For Twitch Local Test, HTTPS is the least painful option. Twitch’s docs note that Local Test uses a Base URI for the frontend and that HTTPS is expected because Twitch itself is served over HTTPS. Chrome can sometimes be configured to allow insecure localhost, but tunnels avoid most browser and CSP friction.

`.env` for Twitch Local Test should look like:

```bash
TWITCH_EXTENSION_CLIENT_ID=<extension client ID>
TWITCH_EXTENSION_SECRET=<base64 extension secret>
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/dungeon_list
PORT=8080
FRONTEND_ORIGIN=https://<frontend-tunnel>
TWITCH_PUBSUB_ENABLED=false
VITE_EBS_BASE_URL=https://<ebs-tunnel>
```

Restart both dev servers after editing `.env`; Vite reads `VITE_*` variables at startup.

Start both:

```bash
npm run dev:ebs
npm run dev:extension
```

In the Twitch Developer Console, use the frontend tunnel or localhost URL as the Local Test Base URI. The Base URI must end with `/`.

```text
https://<frontend-tunnel>/
```

Viewer path:

```text
index.html
```

Add the EBS tunnel host to the extension’s URL-fetching allowlist so the extension iframe can call:

```text
https://<ebs-tunnel>
```

Then move the extension version to Local Test, install it on your channel, activate it in a Component slot, and open your channel page.

## 5. Twitch Developer Console Setup

Create an extension at:

```text
https://dev.twitch.tv/console/extensions
```

Use:

```text
Extension type: Component
Viewer path: index.html
Local Test Base URI: https://<frontend-host>/
URL Fetching Domain Allowlist: <EBS host>
Identity Linking: Enabled
```

Identity linking is required for this app because queue entries need a stable Twitch user ID. Without it, viewers can see the UI but cannot join the waitlist.

The extension frontend already loads the Twitch Extension Helper in `apps/extension/index.html`:

```html
<script src="https://extension-files.twitch.tv/helper/v1/twitch-ext.min.js"></script>
```

## 6. Production / Hosted Test

For Hosted Test or release, do not use the Vite dev server. Build static assets and upload the zip to Twitch.

```bash
npm run build:extension-zip
```

Upload:

```text
extension-build.zip
```

In Twitch’s asset upload flow, upload the contents zip, then move the version to Hosted Test.

Production hosting should use:

```text
Frontend assets: Twitch-hosted extension asset zip
EBS: public HTTPS Node service
Database: managed Postgres
VITE_EBS_BASE_URL: public EBS HTTPS origin at build time
TWITCH_PUBSUB_ENABLED=true
TWITCH_EXTENSION_OWNER_ID=<Twitch user ID that owns the extension>
```

Apply database migrations during deploy:

```bash
npm run prisma:deploy
```

## 7. PubSub

Leave PubSub disabled for early local testing:

```bash
TWITCH_PUBSUB_ENABLED=false
```

Actions still persist to the EBS and the actor gets the updated queue response. Other viewers may need to refresh.

Enable PubSub when testing multiple real Twitch viewers:

```bash
TWITCH_PUBSUB_ENABLED=true
TWITCH_EXTENSION_OWNER_ID=<extension owner Twitch user ID>
```

The EBS signs an `external` role JWT and calls:

```text
POST https://api.twitch.tv/helix/extensions/pubsub
```

It sends a compact `queue.updated` event, and clients refetch `/api/queue`. This keeps PubSub messages small and avoids putting full queue state in Twitch PubSub.

## 8. Why This Setup

Twitch Extensions are sandboxed iframes. The frontend gets a signed Extension JWT from `window.Twitch.ext.onAuthorized`, sends it to the EBS as a bearer token, and the EBS verifies it before allowing queue changes. Twitch refreshes this JWT, so the frontend must always use the latest token.

Twitch’s Content Security Policy restricts fetches from the extension iframe. The EBS host must be listed in the Developer Console’s URL-fetching allowlist.

This repo keeps the waitlist state in the EBS/Postgres instead of the frontend because viewers, moderators, and the broadcaster all need a shared source of truth.

## 9. Troubleshooting

`Open this UI from the Twitch Extension test view`

The app is probably running with `?mock=false` outside Twitch. Remove `?mock=false` for localhost mock mode, or open the extension through Twitch Local Test.

`Share identity to join`

This is expected until the viewer links identity. In localhost mock mode, click `Share`. In Twitch, the Developer Console must have identity linking enabled.

`The waitlist service rejected the request`

Check that `VITE_EBS_BASE_URL` points to the public EBS URL, the EBS is running, and the EBS host is in the URL-fetching allowlist.

`Extension JWT could not be verified`

Check `TWITCH_EXTENSION_CLIENT_ID` and `TWITCH_EXTENSION_SECRET`. The secret must be the base64 extension secret from the Twitch Developer Console.

No updates in another viewer window

Enable PubSub, set `TWITCH_EXTENSION_OWNER_ID`, restart the EBS, and test inside Twitch rather than the standalone mock.

## Sources

- Twitch Extensions overview and Local Test: https://dev.twitch.tv/docs/extensions/
- Twitch Extension EBS, JWT, and PubSub guidance: https://dev.twitch.tv/docs/extensions/building/
- Twitch Extension Helper reference: https://dev.twitch.tv/docs/extensions/reference/
- Send Extension PubSub Message endpoint: https://dev.twitch.tv/docs/api/reference/#send-extension-pubsub-message
