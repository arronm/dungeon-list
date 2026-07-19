CREATE TABLE "viewer_signup_preferences" (
    "channel_id" TEXT NOT NULL,
    "twitch_user_id" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "character_name" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "viewer_signup_preferences_pkey" PRIMARY KEY ("channel_id", "twitch_user_id")
);

ALTER TABLE "viewer_signup_preferences"
ADD CONSTRAINT "viewer_signup_preferences_channel_id_fkey"
FOREIGN KEY ("channel_id") REFERENCES "channels"("twitch_channel_id")
ON DELETE CASCADE ON UPDATE CASCADE;
