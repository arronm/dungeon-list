import type { QueueEvent, QueueStateDto } from "@dungeon-list/shared";
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

  async publishQueueUpdated(queue: QueueStateDto): Promise<boolean> {
    if (!this.config.enabled) {
      return false;
    }

    const event: QueueEvent = {
      type: "queue.updated",
      channelId: queue.channelId,
      revision: queue.revision
    };

    const jwtOptions: Parameters<typeof createExternalPubSubJwt>[1] = {
      extensionSecret: this.config.extensionSecret,
      clientId: this.config.clientId
    };

    if (this.config.ownerId) {
      jwtOptions.ownerId = this.config.ownerId;
    }

    const token = await createExternalPubSubJwt(queue.channelId, jwtOptions);

    const response = await fetch(this.config.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.config.clientId,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        broadcaster_id: queue.channelId,
        target: ["broadcast"],
        message: JSON.stringify(event)
      })
    });

    return response.ok;
  }
}
