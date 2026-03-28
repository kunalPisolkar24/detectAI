import Redis, { Cluster, type ClusterNode, type RedisOptions } from "ioredis";
import { Logger } from "./logger";

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
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
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

      return {
        host,
        port: parseInt(port || "26379", 10),
      };
    });

    const client = new Redis({
      sentinels,
      name: config.masterName,
      password: config.password,
      sentinelPassword: config.password,
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      family: 4,
      keepAlive: 10000,
      lazyConnect: true,
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
      const cleanUrl = url.replace("redis://", "");
      const [host, port] = cleanUrl.split(":");
      return {
        host,
        port: parseInt(port || "6379", 10),
      };
    });

    const cluster = new Cluster(nodes, {
      redisOptions: {
        password: config.password,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      } as RedisOptions,
      retryDelayOnFailover: 100,
      slotsRefreshTimeout: 2000,
      scaleReads: "slave",
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
