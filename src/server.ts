import app from "./app";
import config from "./config";
import logger from "./lib/logger";
import prisma from "./lib/prisma";
import getRedis from "./lib/redis";

if (!process.env.VERCEL) {
    const server = app.listen(config.port, () => {
        logger.info(`CityCare server is running on port ${config.port}`);
    });

    const shutdown = (signal: string) => {
        logger.info(`${signal} received, closing the server`);

        server.close(async () => {
            await prisma.$disconnect();
            getRedis()?.disconnect();
            process.exit(0);
        });

        setTimeout(() => process.exit(1), 10 * 1000).unref();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));
}

export default app;
