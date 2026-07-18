-- Queue events retain entry IDs as soft audit references after queue entries are deleted.
ALTER TABLE "queue_events" DROP CONSTRAINT IF EXISTS "queue_events_entry_id_fkey";
