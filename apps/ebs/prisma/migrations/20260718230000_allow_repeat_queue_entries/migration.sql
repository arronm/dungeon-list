-- Completed entries are history. A viewer may have any number of completed
-- entries, but no more than one active entry in a channel.
DROP INDEX "queue_entries_channel_id_twitch_user_id_key";

CREATE INDEX "queue_entries_channel_id_twitch_user_id_idx"
ON "queue_entries"("channel_id", "twitch_user_id");

CREATE UNIQUE INDEX "queue_entries_channel_id_twitch_user_id_active_key"
ON "queue_entries"("channel_id", "twitch_user_id")
WHERE "status" <> 'completed';
