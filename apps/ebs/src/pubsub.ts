import type { QueueEvent } from "@dungeon-list/shared";
import { createExternalPubSubJwt } from "./auth.js";

export interface PubSubConfig {
  clientId: string;
  extensionSecret: string;
  ownerId?: string;
  enabled: boolean;
  endpoint: string;
}

export class TwitchPubSubPublisher {
  constructor(private readonly config: PubSubConfig) {}

  async publishQueueUpdated(
    recipientChannelId: string,
    revision: string,
    canonicalQueueId?: string
  ): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    const event: QueueEvent = {
      type: "queue.updated",
      recipientChannelId,
      revision
    };
    if (canonicalQueueId) event.canonicalQueueId = canonicalQueueId;

    const jwtOptions: Parameters<typeof createExternalPubSubJwt>[1] = {
      extensionSecret: this.config.extensionSecret,
      clientId: this.config.clientId
    };

    if (this.config.ownerId) {
      jwtOptions.ownerId = this.config.ownerId;
    }

    const token = await createExternalPubSubJwt(recipientChannelId, jwtOptions);

    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.config.clientId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        broadcaster_id: recipientChannelId,
        target: ["broadcast"],
        message: JSON.stringify(event)
      })
    });

    return response.ok;
  }
}
