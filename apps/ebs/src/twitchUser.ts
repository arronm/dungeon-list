import { z } from "zod";
import { ApiError } from "./errors.js";

const twitchUsersResponseSchema = z.object({
  data: z.array(
    z.object({
      id: z.string(),
      display_name: z.string().trim().min(1).max(40)
    })
  )
});

interface CachedDisplayName {
  displayName: string;
  expiresAt: number;
}

export class TwitchUserClient {
  private readonly cache = new Map<string, CachedDisplayName>();

  constructor(
    private readonly clientId: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = "https://api.twitch.tv/helix/users",
    private readonly cacheTtlMs = 15 * 60 * 1000
  ) {}

  async getDisplayName(userId: string, helixToken: string): Promise<string> {
    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.displayName;
    }

    const url = new URL(this.endpoint);
    url.searchParams.set("id", userId);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        headers: {
          Authorization: `Extension ${helixToken}`,
          "Client-Id": this.clientId
        }
      });
    } catch {
      throw twitchLookupError();
    }

    if (!response.ok) {
      throw twitchLookupError();
    }

    try {
      const parsed = twitchUsersResponseSchema.parse(await response.json());
      const user = parsed.data.find((candidate) => candidate.id === userId);
      if (!user) {
        throw twitchLookupError();
      }

      this.cache.set(userId, {
        displayName: user.display_name,
        expiresAt: Date.now() + this.cacheTtlMs
      });
      return user.display_name;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw twitchLookupError();
    }
  }
}

function twitchLookupError(): ApiError {
  return new ApiError(502, "twitch_user_lookup_failed", "Twitch could not provide the viewer's display name.");
}
