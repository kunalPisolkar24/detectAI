import Redis, { Cluster, ClusterNode, RedisOptions } from "ioredis"
import { env } from "@/lib/env"

type RedisClient = Redis | Cluster

const globalForRedis = global as unknown as { usageRedis: RedisClient }

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
  if (env.USE_REDIS_CLUSTER) {
    const nodes = getClusterNodes(env.REDIS_USAGE_URL)
    
    return new Redis.Cluster(nodes, {
      redisOptions: {
        password: env.REDIS_PASSWORD,
        keepAlive: 10000,
        family: 4,
      },
      scaleReads: "slave",
      retryDelayOnFailover: 100,
      slotsRefreshTimeout: 2000,
    })
  }

  const options: RedisOptions = {
    lazyConnect: true,
    password: env.REDIS_PASSWORD,
    keepAlive: 10000,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  }

  return new Redis(env.REDIS_USAGE_URL, options)
}

export const usageRedis = globalForRedis.usageRedis || createClient()

if (env.NODE_ENV !== "production") {
  globalForRedis.usageRedis = usageRedis
}