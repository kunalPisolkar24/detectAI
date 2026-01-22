import { PrismaClient } from './generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { env } from '@/lib/env';

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
  const poolReplica = new Pool({ connectionString: env.DATABASE_URL_REPLICA });

  const adapterPrimary = new PrismaPg(poolPrimary);
  const adapterReplica = new PrismaPg(poolReplica);

  const prismaPrimary = new PrismaClient({ adapter: adapterPrimary });
  const prismaReplica = new PrismaClient({ adapter: adapterReplica });

  return prismaPrimary.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (READ_OPERATIONS.includes(operation)) {
            try {
              return await (prismaReplica as any)[model][operation](args);
            } catch (error) {
              console.warn(
                `[Read Replica Error] ${model}.${operation} failed. Fallback to Primary.`,
                error instanceof Error ? error.message : error
              );
              return query(args);
            }
          }
          return query(args);
        },
      },
    },
  }) as unknown as PrismaClient;
};

export const prisma = globalForPrisma.prisma || createExtendedClient();

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}