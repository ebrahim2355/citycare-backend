import { Redis } from "ioredis";
import config from "../config";
import logger from "./logger";

const FIRST_CONNECT_WAIT_MS = 1500;
const FAIL_FAST_MS = 30 * 1000;

let client: Redis | null = null;
let lastErrorAt = 0;
let wasReady = false;
let lastWaitFailedAt = 0;

const getRedis = (): Redis | null => {
    if (!config.redisUrl) {
        return null;
    }

    if (!client) {
        client = new Redis(config.redisUrl, {
            maxRetriesPerRequest: 1,
            connectTimeout: 5000,
            commandTimeout: 2000,
            retryStrategy: (attempt) => Math.min(attempt * 500, 5000),
        });

        client.on("ready", () => {
            wasReady = true;
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

const waitUntilReady = (redis: Redis, timeoutMs: number) => {
    return new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => finish(false), timeoutMs);
        const onReady = () => finish(true);
        const onClose = () => finish(false);

        function finish(ready: boolean) {
            clearTimeout(timer);
            redis.off("ready", onReady);
            redis.off("close", onClose);
            resolve(ready);
        }

        redis.once("ready", onReady);
        redis.once("close", onClose);
    });
};

export const getReadyRedis = async (): Promise<Redis | null> => {
    const redis = getRedis();

    if (!redis || redis.status === "ready") {
        return redis;
    }

    if (wasReady || Date.now() - lastWaitFailedAt < FAIL_FAST_MS) {
        return null;
    }

    const ready = await waitUntilReady(redis, FIRST_CONNECT_WAIT_MS);

    if (!ready) {
        lastWaitFailedAt = Date.now();
    }

    return ready ? redis : null;
};

export const getRedisStatus = async (): Promise<"up" | "down" | "disabled"> => {
    if (!config.redisUrl) {
        return "disabled";
    }

    const redis = await getReadyRedis();

    if (!redis) {
        return "down";
    }

    try {
        await redis.ping();

        return "up";
    } catch {
        return "down";
    }
};

export default getRedis;
