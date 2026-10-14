import { PrismaPg } from "@prisma/adapter-pg";
import config from "../config";
import { PrismaClient } from "../generated/prisma/client";

const adapter = new PrismaPg({
    connectionString: config.databaseUrl,
    max: config.databasePoolMax,
    idleTimeoutMillis: 30 * 1000,
    connectionTimeoutMillis: 10 * 1000,
});

const prisma = new PrismaClient({
    adapter,
    transactionOptions: { maxWait: 5 * 1000, timeout: 15 * 1000 },
});

export default prisma;
