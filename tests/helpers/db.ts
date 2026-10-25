import prisma from "../../src/lib/prisma";
import getRedis from "../../src/lib/redis";

export const resetDatabase = async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;

    if (tables.length) {
        await prisma.$executeRawUnsafe(
            `TRUNCATE TABLE ${tables.map((table) => `"public"."${table.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`
        );
    }

    await getRedis()?.flushdb();
};

export { prisma };
