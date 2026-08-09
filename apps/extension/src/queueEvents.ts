import { queueEventSchema } from "@dungeon-list/shared";

export function isQueueEventForChannel(message: string, channelId: string | undefined): boolean {
  if (!channelId) return false;
  try {
    const event = queueEventSchema.safeParse(JSON.parse(message));
    return event.success && event.data.recipientChannelId === channelId;
  } catch {
    return false;
  }
}
