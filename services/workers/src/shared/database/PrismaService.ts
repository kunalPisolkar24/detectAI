import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client";
import { Logger } from "../logging/Logger";

let _prismaPrimary: PrismaClient;
let _prismaReplica: PrismaClient;
let _prisma: PrismaClient;

const READ_OPERATIONS = [
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
];

function initializeClients() {
  const primaryUrl = process.env.DATABASE_URL;
  const replicaUrl = process.env.DATABASE_URL_REPLICA || primaryUrl;

  console.log(`Initializing Prisma clients. DATABASE_URL: ${primaryUrl}`);

  if (!primaryUrl) {
    throw new Error("DATABASE_URL is not defined");
  }

  const poolConfig = {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  const poolPrimary = new Pool({
    connectionString: primaryUrl,
    ...poolConfig
  });

  const poolReplica = new Pool({
    connectionString: replicaUrl,
    ...poolConfig
  });

  const adapterPrimary = new PrismaPg(poolPrimary);
  const adapterReplica = new PrismaPg(poolReplica);

  _prismaPrimary = new PrismaClient({
    adapter: adapterPrimary,
  });

  _prismaReplica = new PrismaClient({
    adapter: adapterReplica,
  });

  _prisma = _prismaPrimary.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (READ_OPERATIONS.includes(operation)) {
            try {
              return await (_prismaReplica as any)[model][operation](args);
            } catch (error) {
              Logger.warn(`Replica read failed for ${model}.${operation}, falling back to Primary`, {
                error: error instanceof Error ? error.message : error
              });
              return query(args);
            }
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
}

export const prismaPrimary: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, prop) {
    if (!_prismaPrimary) initializeClients();
    return (_prismaPrimary as any)[prop];
  }
});

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, prop) {
    if (!_prisma) initializeClients();
    return (_prisma as any)[prop];
  }
});