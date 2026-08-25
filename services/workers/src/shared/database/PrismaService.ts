import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client";
import { Logger } from "../logging/Logger";

let _prismaPrimary: PrismaClient;
let _prismaReplica: PrismaClient;
let _prisma: PrismaClient;
let _poolPrimary: Pool;
let _poolReplica: Pool;

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

function redactConnectionString(url: string | undefined): string {
  if (!url) return "<missing>";
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.username}:***@${parsed.host}${parsed.pathname}`;
  } catch {
    return "<unparseable>";
  }
}

function initializeClients() {
  const primaryUrl = process.env.DATABASE_URL;
  const replicaUrl = process.env.DATABASE_URL_REPLICA || primaryUrl;

  Logger.info(`Initializing Prisma clients (${redactConnectionString(primaryUrl)})`);

  if (!primaryUrl) {
    throw new Error("DATABASE_URL is not defined");
  }

  const poolConfig = {
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  _poolPrimary = new Pool({
    connectionString: primaryUrl,
    ...poolConfig
  });

  _poolReplica = new Pool({
    connectionString: replicaUrl,
    ...poolConfig
  });

  const adapterPrimary = new PrismaPg(_poolPrimary);
  const adapterReplica = new PrismaPg(_poolReplica);

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

function ensureInitialized() {
  if (!_prismaPrimary) initializeClients();
}

export function getPgPool(name: "primary" | "replica"): Pool | null {
  ensureInitialized();
  return name === "primary" ? _poolPrimary : _poolReplica;
}

export const prismaPrimary: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, prop) {
    ensureInitialized();
    return (_prismaPrimary as any)[prop];
  }
});

export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_, prop) {
    ensureInitialized();
    return (_prisma as any)[prop];
  }
});
