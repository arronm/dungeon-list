# Dungeon List

Twitch Extension for managing a viewer waitlist for dungeon runs.

The repository is split into three workspaces:

- `apps/extension`: Twitch Component Extension UI built with React and Vite.
- `apps/ebs`: Extension Backend Service built with Fastify, Prisma, and Twitch Extension JWT verification.
- `packages/shared`: Shared queue types and validation schemas.

See [docs/twitch-extension-setup.md](docs/twitch-extension-setup.md) for Twitch Developer Console setup, required environment variables, and local development notes.

## Quick Start

```bash
npm install
npm run prisma:generate
npm run build
```

Copy `.env.example` to `.env` and fill in the Twitch Extension values before running the backend.

```bash
npm run dev:ebs
npm run dev:extension
```

The extension frontend expects `VITE_EBS_BASE_URL` to point at the public HTTPS URL of the EBS when running inside Twitch.

Broadcasters and moderators also receive current Mythic+ scores from Raider.IO. Lookups run through the EBS, are cached in memory for two hours, and degrade without blocking queue operations when Raider.IO is unavailable.

The current Mythic+ dungeon rotation and its compact UI labels are maintained in `packages/shared/src/dungeons.ts` and should be updated when the seasonal pool changes.
