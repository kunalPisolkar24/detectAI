import { PrismaClient } from '../shared/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { env } from '@/lib/config/env';
import { metrics } from '@/lib/infrastructure/metrics';
import { logger } from '@/lib/infrastructure/logger';

const isPreviewMode = () => process.env.PREVIEW_MODE === "true" || process.env.NEXT_PUBLIC_PREVIEW_MODE === "true"

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

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient;
};

const createPreviewPrisma = (): PrismaClient => {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === "then") return undefined
      return () => {
        throw new Error(`Prisma.${String(prop)} is not available in preview mode`)
      }
    },
  }
  return new Proxy({}, handler) as unknown as PrismaClient
}

const createExtendedClient = () => {
  if (isPreviewMode()) {
    return createPreviewPrisma()
  }
  const primaryUrl = env.DATABASE_URL
  const replicaUrl = env.DATABASE_URL_REPLICA ?? primaryUrl
  const poolMax = parseInt(process.env.POOL_MAX || "5", 10)
  const needsSSL = primaryUrl.includes("sslmode=require") || primaryUrl.includes("sslmode=verify")
  const poolConfig: ConstructorParameters<typeof Pool>[0] = {
    max: Number.isFinite(poolMax) && poolMax > 0 ? poolMax : 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    options: "-c statement_timeout=30000",
    ...(needsSSL ? { ssl: { rejectUnauthorized: false } } : {}),
  }
  const poolPrimary = new Pool({ connectionString: primaryUrl, ...poolConfig })
  // Reuse primary pool when replica resolves to the same URL (standalone / local Floci)
  const poolReplica = replicaUrl === primaryUrl ? poolPrimary : new Pool({ connectionString: replicaUrl, ...poolConfig })

  const adapterPrimary = new PrismaPg(poolPrimary);
  const adapterReplica = new PrismaPg(poolReplica);

  const prismaPrimary = new PrismaClient({ adapter: adapterPrimary });
  const prismaReplica = new PrismaClient({ adapter: adapterReplica });

  return prismaPrimary.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const start = performance.now();
          const isRead = READ_OPERATIONS.includes(operation);

          try {
            const result = await (isRead
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ? (prismaReplica as any)[model][operation](args)
              : query(args));

            const duration = (performance.now() - start) / 1000;
            metrics.dbQueryDuration.observe(
              { model, operation, status: 'success' },
              duration
            );

            return result;
          } catch (error) {
            const duration = (performance.now() - start) / 1000;
            metrics.dbQueryDuration.observe(
              { model, operation, status: 'error' },
              duration
            );

            logger.error({
              msg: "DB Query Failed",
              model,
              operation,
              error: error instanceof Error ? error.message : error
            });

            throw error;
          }
        },
      },
    },
  }) as unknown as PrismaClient;
};

export const prisma = isPreviewMode() ? createPreviewPrisma() : globalForPrisma.prisma || createExtendedClient();

if (!isPreviewMode() && env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
