import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { env } from '@/lib/env';
import { metrics } from '@/lib/metrics';
import { logger } from '@/lib/logger';

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

const createExtendedClient = () => {
  const poolPrimary = new Pool({ connectionString: env.DATABASE_URL });
  const poolReplica = new Pool({ connectionString: env.DATABASE_URL_REPLICA ?? env.DATABASE_URL });

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

export const prisma = globalForPrisma.prisma || createExtendedClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
