-- CreateEnum
CREATE TYPE "QueueEntryRole" AS ENUM ('tank', 'healer', 'dps');

-- CreateEnum
CREATE TYPE "QueueEntryStatus" AS ENUM ('waiting', 'invited', 'completed', 'skipped');

-- CreateTable
CREATE TABLE "channels" (
    "twitch_channel_id" TEXT NOT NULL,
    "signups_open" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("twitch_channel_id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "twitch_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "QueueEntryRole" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "status" "QueueEntryStatus" NOT NULL DEFAULT 'waiting',
    "position" INTEGER NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_events" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "entry_id" TEXT,
    "actor_twitch_user_id" TEXT,
    "actor_role" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "queue_entries_channel_id_status_position_idx" ON "queue_entries"("channel_id", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "queue_entries_channel_id_twitch_user_id_key" ON "queue_entries"("channel_id", "twitch_user_id");

-- CreateIndex
CREATE INDEX "queue_events_channel_id_created_at_idx" ON "queue_events"("channel_id", "created_at");

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("twitch_channel_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_events" ADD CONSTRAINT "queue_events_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("twitch_channel_id") ON DELETE CASCADE ON UPDATE CASCADE;

