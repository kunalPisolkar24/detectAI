import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../../generated/prisma/client";
import { Logger } from "../logging/Logger";
import { AsyncLocalStorage } from "node:async_hooks";

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

// AsyncLocalStorage to track if we're inside a transaction callback.
// Used to bypass replica routing for transactional reads.
const txContext = new AsyncLocalStorage<boolean>();

const REPLICA_RETRY_CODES = new Set(["P1001", "P1002", "P1017", "P1008", "P1003_TIMEOUT"]);

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

  const poolMax = parseInt(process.env.POOL_MAX || "10", 10);
  const poolConfig = {
    max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  _poolPrimary = new Pool({
    connectionString: primaryUrl,
    ...poolConfig
  });

  // Reuse primary pool if replica URL equals primary to avoid 2x connections (20/worker when single DB)
  if (replicaUrl === primaryUrl) {
    _poolReplica = _poolPrimary;
    Logger.info("Replica URL identical to primary — reusing single pool");
  } else {
    _poolReplica = new Pool({
      connectionString: replicaUrl,
      ...poolConfig
    });
  }

  // Prevent unhandled 'error' events from crashing process (idle client errors)
  _poolPrimary.on("error", (err) => {
    Logger.error("Prisma primary pool error", err);
  });
  if (_poolReplica !== _poolPrimary) {
    _poolReplica.on("error", (err) => {
      Logger.error("Prisma replica pool error", err);
    });
  }

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
          // Bypass replica routing when inside a transaction callback — must use primary snapshot
          if (txContext.getStore()) {
            return query(args);
          }
          if (READ_OPERATIONS.includes(operation)) {
            try {
              return await (_prismaReplica as any)[model][operation](args);
            } catch (error: any) {
              const code = error?.code as string | undefined;
              const msg = String(error?.message ?? "");
              const isConnError =
                (code && REPLICA_RETRY_CODES.has(code)) ||
                msg.includes("Can't reach database server") ||
                msg.includes("Timed out fetching a new connection") ||
                msg.includes("Connection terminated");
              if (!isConnError) {
                throw error;
              }
              Logger.warn(`Replica read failed for ${model}.${operation}, falling back to Primary`, {
                error: error instanceof Error ? error.message : error,
                code,
              });
              return query(args);
            }
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;

  // Wrap $transaction to set AsyncLocalStorage flag so replica routing is bypassed inside
  const originalTransaction = _prismaPrimary.$transaction.bind(_prismaPrimary);
  (_prismaPrimary as any).$transaction = ((...tArgs: any[]) => {
    return txContext.run(true, () => (originalTransaction as any)(...tArgs));
  }) as typeof _prismaPrimary.$transaction;
  // Also wrap the extended client's $transaction
  const extendedTx = (_prisma as any).$transaction?.bind(_prisma);
  if (extendedTx) {
    (_prisma as any).$transaction = ((...tArgs: any[]) => {
      return txContext.run(true, () => (extendedTx as any)(...tArgs));
    }) as any;
  }
}

function ensureInitialized() {
  if (!_prismaPrimary) initializeClients();
}

export function getPgPool(name: "primary" | "replica"): Pool | null {
  ensureInitialized();
  return name === "primary" ? _poolPrimary : _poolReplica;
}

function createProxy(getTarget: () => PrismaClient): PrismaClient {
  return new Proxy({} as PrismaClient, {
    get(_, prop) {
      ensureInitialized();
      const target = getTarget() as any;
      const value = target[prop];
      if (typeof value === "function") {
        return value.bind(target);
      }
      return value;
    },
    has(_, prop) {
      ensureInitialized();
      return prop in (getTarget() as any);
    },
    getPrototypeOf() {
      ensureInitialized();
      return Object.getPrototypeOf(getTarget() as any);
    },
  });
}

export const prismaPrimary: PrismaClient = createProxy(() => _prismaPrimary);

export const prisma: PrismaClient = createProxy(() => _prisma);

export async function closePrisma(): Promise<void> {
  try {
    if (_prismaPrimary) await _prismaPrimary.$disconnect();
  } catch {}
  try {
    if (_prismaReplica && _prismaReplica !== _prismaPrimary) await _prismaReplica.$disconnect();
  } catch {}
  try {
    if (_poolPrimary) await _poolPrimary.end();
  } catch {}
  try {
    if (_poolReplica && _poolReplica !== _poolPrimary) await _poolReplica.end();
  } catch {}
  // Reset for test re-initialization
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_prismaPrimary as any) = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_prismaReplica as any) = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_prisma as any) = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_poolPrimary as any) = undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (_poolReplica as any) = undefined;
}
