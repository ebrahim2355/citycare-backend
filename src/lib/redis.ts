import { Redis } from "ioredis";
import config from "../config";
import logger from "./logger";

let client: Redis | null = null;
let lastErrorAt = 0;

const getRedis = (): Redis | null => {
    if (!config.redisUrl) {
        return null;
    }

    if (!client) {
        client = new Redis(config.redisUrl, {
            maxRetriesPerRequest: 1,
            connectTimeout: 5000,
            retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
        });

        client.on("error", (error) => {
            if (Date.now() - lastErrorAt > 60 * 1000) {
                lastErrorAt = Date.now();
                logger.warn({ err: error }, "Redis connection error");
            }
        });
    }

    return client;
};

export const getRedisStatus = async (): Promise<"up" | "down" | "disabled"> => {
    const redis = getRedis();

    if (!redis) {
        return "disabled";
    }

    try {
        await redis.ping();

        return "up";
    } catch {
        return "down";
    }
};

export default getRedis;
