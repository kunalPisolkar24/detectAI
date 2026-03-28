import Redis, { Cluster, ClusterNode, RedisOptions } from "ioredis"
import { env } from "@/lib/env"

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

    return cluster
  }

  const options: RedisOptions = {
    lazyConnect: true,
    password: env.REDIS_USAGE_PASSWORD,
    keepAlive: 10000,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  }

  const client = new Redis(env.REDIS_USAGE_URL, options)
  
  client.on("error", (err) => {
    console.error("Redis Usage Client Error:", err.message)
  })

  return client
}

export const usageRedis = globalForRedis.usageRedis || createClient()

if (env.NODE_ENV !== "production") {
  globalForRedis.usageRedis = usageRedis
}
