import Redis, { Cluster, ClusterNode, RedisOptions } from "ioredis"
import { env } from "@/lib/config/env"

const isPreviewMode = () => process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"

const createPreviewUsageRedis = () =>
  new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === "then") return undefined
        if (prop === "pipeline") {
          return () => ({
            incr: function () { return this },
            expire: function () { return this },
            exec: async () => [],
          })
        }
        return async () => null
      },
    },
  ) as unknown as RedisClient

type RedisClient = Redis | Cluster

const globalForRedis = global as unknown as { usageRedis: RedisClient }

const getUsageMode = () => {
  if (env.REDIS_USAGE_MODE) {
    return env.REDIS_USAGE_MODE
  }

  return env.USE_REDIS_CLUSTER ? "cluster" : "standalone"
}

const getClusterNodes = (urlString: string): ClusterNode[] => {
  return urlString.split(",").map((url) => {
    const cleanUrl = url.replace("redis://", "")
    const [host, port] = cleanUrl.split(":")
    return {
      host,
      port: parseInt(port || "6379", 10),
    }
  })
}

const createClient = (): RedisClient => {
  if (isPreviewMode()) return createPreviewUsageRedis()
  if (getUsageMode() === "cluster") {
    const nodes = getClusterNodes(env.REDIS_USAGE_URL)

    const cluster = new Redis.Cluster(nodes, {
      redisOptions: {
        password: env.REDIS_USAGE_PASSWORD,
        keepAlive: 10000,
        family: 4,
        lazyConnect: true,
      },
      scaleReads: "slave",
      retryDelayOnFailover: 100,
      slotsRefreshTimeout: 2000,
      lazyConnect: true,
    })

    cluster.on("error", (err) => {
      console.error("Redis Cluster Error:", err.message)
    })
    cluster.on("close", () => {
      console.error("Redis Cluster closed")
    })

    return cluster
  }

  const options: RedisOptions = {
    lazyConnect: true,
    password: env.REDIS_USAGE_PASSWORD,
    keepAlive: 10000,
    // Same fail-fast rationale as redis.ts — degrade to DB quickly.
    retryStrategy: (times) => (times > 3 ? null : Math.min(times * 50, 500)),
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    enableReadyCheck: true,
  }

  const client = new Redis(env.REDIS_USAGE_URL, options)
  
  client.on("error", (err) => {
    console.error("Redis Usage Client Error:", err.message)
  })
  client.on("close", () => {
    console.error("Redis Usage Client closed")
  })

  return client
}

export const usageRedis = isPreviewMode() ? createClient() : globalForRedis.usageRedis || createClient()

if (!isPreviewMode() && env.NODE_ENV !== "production") {
  globalForRedis.usageRedis = usageRedis
}
