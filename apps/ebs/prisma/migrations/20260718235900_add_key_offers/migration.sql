CREATE TABLE "key_offers" (
    "id" TEXT NOT NULL,
    "channel_id" TEXT NOT NULL,
    "twitch_user_id" TEXT NOT NULL,
    "display_name" TEXT,
    "role" "QueueEntryRole" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "key_offers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "key_offers_channel_id_created_at_idx"
ON "key_offers"("channel_id", "created_at");

CREATE INDEX "key_offers_channel_id_twitch_user_id_idx"
ON "key_offers"("channel_id", "twitch_user_id");

ALTER TABLE "key_offers"
ADD CONSTRAINT "key_offers_channel_id_fkey"
FOREIGN KEY ("channel_id") REFERENCES "channels"("twitch_channel_id")
ON DELETE CASCADE ON UPDATE CASCADE;
