import app from "./app";
import config from "./config";
import prisma from "./lib/prisma";
import getRedis from "./lib/redis";

if (!process.env.VERCEL) {
    const server = app.listen(config.port, () => {
        console.log(`CityCare server is running on port ${config.port}`);
    });

    const shutdown = (signal: string) => {
        console.log(`${signal} received, closing the server`);

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
