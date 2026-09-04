import Redis, { Cluster, type ClusterNode, type RedisOptions } from "ioredis";
import { Logger } from "../logging/Logger";

export type RedisClient = Redis | Cluster;
export type RedisMode = "standalone" | "sentinel" | "cluster";

export interface RedisConnectionConfig {
  mode: RedisMode;
  name: string;
  url?: string;
  sentinels?: string;
  masterName?: string;
  password?: string;
}

export class RedisFactory {
  public static createClient(config: RedisConnectionConfig): RedisClient {
    switch (config.mode) {
      case "cluster":
        return RedisFactory.createCluster(config);
      case "sentinel":
        return RedisFactory.createSentinel(config);
      default:
        return RedisFactory.createStandalone(config);
    }
  }

  private static createStandalone(config: RedisConnectionConfig): Redis {
    if (!config.url) {
      throw new Error(`Redis URL is required for ${config.name}`);
    }

    const client = new Redis(config.url, {
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

  private static createSentinel(config: RedisConnectionConfig): Redis {
    if (!config.sentinels) {
      throw new Error(`Redis sentinels are required for ${config.name}`);
    }

    if (!config.masterName) {
      throw new Error(`Redis master name is required for ${config.name}`);
    }

    const sentinels = config.sentinels.split(",").map((entry) => {
      const [host, port] = entry.split(":");
      const h = host?.trim();
      if (!h) throw new Error(`Invalid sentinel entry: ${entry}`);
      return {
        host: h,
        port: parseInt(port || "26379", 10),
      };
    });

    const client = new Redis({
      sentinels,
      name: config.masterName,
      password: config.password,
      sentinelPassword: config.password,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      family: 4,
      keepAlive: 10000,
      lazyConnect: false,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
    });

    RedisFactory.attachListeners(client, config.name);
    return client;
  }

  private static createCluster(config: RedisConnectionConfig): Cluster {
    if (!config.url) {
      throw new Error(`Redis URL is required for ${config.name}`);
    }

    const nodes: ClusterNode[] = config.url.split(",").map((url) => {
      const trimmed = url.trim();
      if (!trimmed) throw new Error(`Invalid cluster URL entry: ${url}`);
      let parsed: URL;
      try {
        parsed = new URL(trimmed);
      } catch {
        // Fallback for bare host:port
        const [host, port] = trimmed.replace(/^rediss?:\/\//, "").split(":");
        return {
          host,
          port: parseInt(port || "6379", 10),
        };
      }
      if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
        throw new Error(`Unsupported Redis protocol: ${parsed.protocol} in ${trimmed}`);
      }
      return {
        host: parsed.hostname,
        port: parseInt(parsed.port || "6379", 10),
      };
    });

    const cluster = new Cluster(nodes, {
      redisOptions: {
        password: config.password,
        maxRetriesPerRequest: 3,
        enableReadyCheck: true,
        enableOfflineQueue: false,
      } as RedisOptions,
      retryDelayOnFailover: 100,
      slotsRefreshTimeout: 2000,
      scaleReads: "master",
    });

    RedisFactory.attachListeners(cluster, config.name);
    return cluster;
  }

  private static attachListeners(client: Redis | Cluster, name: string) {
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
