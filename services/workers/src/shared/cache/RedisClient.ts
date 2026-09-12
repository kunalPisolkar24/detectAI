import Redis from "ioredis";
import { Logger } from "../logging/Logger";

export type RedisClient = Redis;

export interface RedisConnectionConfig {
  name: string;
  url?: string;
  password?: string;
}

export class RedisFactory {
  public static createClient(config: RedisConnectionConfig): RedisClient {
    if (!config.url) throw new Error(`Redis URL is required for ${config.name}`);
    const client = new Redis(config.url, {
      password: config.password || undefined,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
    });
    RedisFactory.attachListeners(client, config.name);
    return client;
  }

  private static attachListeners(client: Redis, name: string) {
    client.on("error", (error) => {
      Logger.error(`${name} connection error`, error);
    });
    client.on("connect", () => {
      Logger.info(`${name} connected successfully`);
    });
    client.on("ready", () => {
      Logger.info(`${name} is ready`);
    });
  }
}
