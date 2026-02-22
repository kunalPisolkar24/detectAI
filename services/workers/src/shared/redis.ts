import Redis, { Cluster, type RedisOptions,type ClusterNode } from "ioredis";
import { Logger } from "./logger";

export type RedisClient = Redis | Cluster;

export class RedisFactory {
  public static createClient(
    url: string, 
    mode: "standalone" | "cluster", 
    name: string
  ): RedisClient {
    if (mode === "cluster") {
      return RedisFactory.createCluster(url, name);
    }
    return RedisFactory.createStandalone(url, name);
  }

  private static createStandalone(url: string, name: string): Redis {
    const client = new Redis(url, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        return Math.min(times * 50, 2000);
      },
    });

    RedisFactory.attachListeners(client, name);
    return client;
  }

  private static createCluster(connectionString: string, name: string): Cluster {
    const nodes: ClusterNode[] = connectionString.split(",").map((url) => {
      const cleanUrl = url.replace("redis://", "");
      const [host, port] = cleanUrl.split(":");
      return {
        host,
        port: parseInt(port || "6379", 10),
      };
    });

    const cluster = new Cluster(nodes, {
      redisOptions: {
        password: process.env.REDIS_PASSWORD,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
      } as RedisOptions,
      retryDelayOnFailover: 100,
      slotsRefreshTimeout: 2000,
      scaleReads: "slave",
    });

    RedisFactory.attachListeners(cluster, name);
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