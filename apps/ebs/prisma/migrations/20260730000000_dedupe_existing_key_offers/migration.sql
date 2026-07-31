CREATE TEMP TABLE "_key_offer_dedupe_candidates" (
    "id" TEXT PRIMARY KEY,
    "channel_id" TEXT NOT NULL,
    "twitch_user_id" TEXT NOT NULL,
    "character_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL
);

DO $$
DECLARE
    offer RECORD;
    details JSONB;
    character_key TEXT;
BEGIN
    FOR offer IN
        SELECT "id", "channel_id", "twitch_user_id", "note", "created_at"
        FROM "key_offers"
    LOOP
        BEGIN
            IF offer."note" LIKE 'character:v2:%' THEN
                details := substring(offer."note" FROM length('character:v2:') + 1)::JSONB;

                IF
                    jsonb_typeof(details) = 'array'
                    AND jsonb_array_length(details) >= 2
                    AND jsonb_typeof(details -> 0) = 'string'
                    AND jsonb_typeof(details -> 1) = 'string'
                THEN
                    character_key := concat(
                        '[',
                        to_jsonb(lower(details ->> 0))::TEXT,
                        ',',
                        to_jsonb(lower(details ->> 1))::TEXT,
                        ']'
                    );

                    INSERT INTO "_key_offer_dedupe_candidates"
                        ("id", "channel_id", "twitch_user_id", "character_key", "created_at")
                    VALUES
                        (
                            offer."id",
                            offer."channel_id",
                            offer."twitch_user_id",
                            character_key,
                            offer."created_at"
                        );
                END IF;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            -- Preserve malformed legacy records rather than blocking the deployment.
            NULL;
        END;
    END LOOP;
END $$;

DELETE FROM "key_offers"
WHERE "id" IN (
    SELECT "id"
    FROM (
        SELECT
            "id",
            row_number() OVER (
                PARTITION BY "channel_id", "twitch_user_id", "character_key"
                ORDER BY "created_at" DESC, "id" DESC
            ) AS duplicate_number
        FROM "_key_offer_dedupe_candidates"
    ) ranked_offers
    WHERE duplicate_number > 1
);

DROP TABLE "_key_offer_dedupe_candidates";
