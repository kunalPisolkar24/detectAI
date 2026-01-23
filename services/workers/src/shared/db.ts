import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";
import { Logger } from "./logger";

const primaryUrl = process.env.DATABASE_URL;
const replicaUrl = process.env.DATABASE_URL_REPLICA || primaryUrl;

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

export const prismaPrimary = new PrismaClient({
  adapter: adapterPrimary,
});

const prismaReplica = new PrismaClient({
  adapter: adapterReplica,
});

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

export const prisma = prismaPrimary.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (READ_OPERATIONS.includes(operation)) {
          try {
            return await (prismaReplica as any)[model][operation](args);
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