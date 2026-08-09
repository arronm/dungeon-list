-- Atomic queue revisions replace timestamp-based concurrency tokens.
ALTER TABLE "channels" ADD COLUMN "revision" BIGINT NOT NULL DEFAULT 0;

-- Source and actor attribution are backfilled before becoming required.
ALTER TABLE "queue_entries" ADD COLUMN "submitted_via_channel_id" TEXT;
UPDATE "queue_entries" SET "submitted_via_channel_id" = "channel_id";
ALTER TABLE "queue_entries" ALTER COLUMN "submitted_via_channel_id" SET NOT NULL;

ALTER TABLE "key_offers" ADD COLUMN "submitted_via_channel_id" TEXT;
UPDATE "key_offers" SET "submitted_via_channel_id" = "channel_id";
ALTER TABLE "key_offers" ALTER COLUMN "submitted_via_channel_id" SET NOT NULL;

ALTER TABLE "queue_events" ADD COLUMN "actor_channel_id" TEXT;
UPDATE "queue_events" SET "actor_channel_id" = "channel_id";
ALTER TABLE "queue_events" ALTER COLUMN "actor_channel_id" SET NOT NULL;

CREATE TYPE "CollaborationMemberRole" AS ENUM ('host', 'collaborator');

CREATE TABLE "collaborations" (
  "id" TEXT NOT NULL,
  "host_channel_id" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ended_at" TIMESTAMP(3),
  CONSTRAINT "collaborations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_memberships" (
  "id" TEXT NOT NULL,
  "collaboration_id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "role" "CollaborationMemberRole" NOT NULL,
  "display_name" TEXT NOT NULL,
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "left_at" TIMESTAMP(3),
  CONSTRAINT "collaboration_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_invites" (
  "id" TEXT NOT NULL,
  "host_channel_id" TEXT NOT NULL,
  "collaborator_channel_id" TEXT NOT NULL,
  "host_display_name" TEXT NOT NULL,
  "collaborator_display_name" TEXT NOT NULL,
  "code" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  CONSTRAINT "collaboration_invites_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "collaboration_invite_attempts" (
  "id" TEXT NOT NULL,
  "channel_id" TEXT NOT NULL,
  "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "collaboration_invite_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "collaborations_host_channel_id_ended_at_idx" ON "collaborations"("host_channel_id", "ended_at");
CREATE INDEX "collaboration_memberships_collaboration_id_left_at_idx" ON "collaboration_memberships"("collaboration_id", "left_at");
CREATE INDEX "collaboration_memberships_channel_id_left_at_idx" ON "collaboration_memberships"("channel_id", "left_at");
CREATE INDEX "collaboration_invites_host_channel_id_created_at_idx" ON "collaboration_invites"("host_channel_id", "created_at");
CREATE INDEX "collaboration_invites_collaborator_channel_id_created_at_idx" ON "collaboration_invites"("collaborator_channel_id", "created_at");
CREATE UNIQUE INDEX "collaboration_invites_code_key" ON "collaboration_invites"("code");
CREATE INDEX "collaboration_invite_attempts_channel_id_attempted_at_idx" ON "collaboration_invite_attempts"("channel_id", "attempted_at");
CREATE INDEX "queue_entries_channel_id_submitted_via_channel_id_status_position_idx"
  ON "queue_entries"("channel_id", "submitted_via_channel_id", "status", "position");
CREATE INDEX "key_offers_channel_id_submitted_via_channel_id_idx"
  ON "key_offers"("channel_id", "submitted_via_channel_id");

-- PostgreSQL partial indexes enforce active membership invariants that Prisma cannot express.
CREATE UNIQUE INDEX "collaboration_memberships_one_active_channel"
  ON "collaboration_memberships"("channel_id") WHERE "left_at" IS NULL;
CREATE UNIQUE INDEX "collaboration_memberships_one_active_role"
  ON "collaboration_memberships"("collaboration_id", "role") WHERE "left_at" IS NULL;
CREATE UNIQUE INDEX "collaborations_one_active_host"
  ON "collaborations"("host_channel_id") WHERE "ended_at" IS NULL;
CREATE UNIQUE INDEX "collaboration_invites_one_pending_host"
  ON "collaboration_invites"("host_channel_id")
  WHERE "code" IS NOT NULL AND "consumed_at" IS NULL AND "revoked_at" IS NULL;

ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_host_channel_id_fkey"
  FOREIGN KEY ("host_channel_id") REFERENCES "channels"("twitch_channel_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaboration_memberships" ADD CONSTRAINT "collaboration_memberships_collaboration_id_fkey"
  FOREIGN KEY ("collaboration_id") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_memberships" ADD CONSTRAINT "collaboration_memberships_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "channels"("twitch_channel_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "collaboration_invites" ADD CONSTRAINT "collaboration_invites_host_channel_id_fkey"
  FOREIGN KEY ("host_channel_id") REFERENCES "channels"("twitch_channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_invites" ADD CONSTRAINT "collaboration_invites_collaborator_channel_id_fkey"
  FOREIGN KEY ("collaborator_channel_id") REFERENCES "channels"("twitch_channel_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collaboration_invite_attempts" ADD CONSTRAINT "collaboration_invite_attempts_channel_id_fkey"
  FOREIGN KEY ("channel_id") REFERENCES "channels"("twitch_channel_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "collaboration_invites" ADD CONSTRAINT "collaboration_invites_distinct_channels_check"
  CHECK ("host_channel_id" <> "collaborator_channel_id");
