import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../generated/prisma/client";

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({ 
    connectionString,
    max: 10,
    idleTimeoutMillis: 30000
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
    adapter,
});