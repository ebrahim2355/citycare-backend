import type { Response } from "express";
import { getReadyRedis } from "../lib/redis";

const PREFIX = "citycare:cache:";

export const CATALOG_CACHE_SECONDS = 5 * 60;

export const cacheKeys = {
    departments: "departments:list",
    categoriesPrefix: "categories:",
    categories: (type = "all", departmentId = "all") => `categories:${type}:${departmentId}`,
    publicReportsPrefix: "public-reports:",
};

export const getCache = async <T>(key: string): Promise<T | null> => {
    const redis = await getReadyRedis();

    if (!redis) {
        return null;
    }

    try {
        const value = await redis.get(`${PREFIX}${key}`);

        return value ? (JSON.parse(value) as T) : null;
    } catch {
        return null;
    }
};

export const setCache = async (key: string, value: unknown, ttlSeconds: number) => {
    const redis = await getReadyRedis();

    if (!redis) {
        return;
    }

    try {
        await redis.set(`${PREFIX}${key}`, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
        return;
    }
};

export const deleteCache = async (...keys: string[]) => {
    const redis = await getReadyRedis();

    if (!redis || !keys.length) {
        return;
    }

    try {
        await redis.del(...keys.map((key) => `${PREFIX}${key}`));
    } catch {
        return;
    }
};

export const deleteCacheByPrefix = async (prefix: string) => {
    const redis = await getReadyRedis();

    if (!redis) {
        return;
    }

    try {
        let cursor = "0";

        do {
            const [nextCursor, keys] = await redis.scan(cursor, "MATCH", `${PREFIX}${prefix}*`, "COUNT", 100);

            if (keys.length) {
                await redis.del(...keys);
            }

            cursor = nextCursor;
        } while (cursor !== "0");
    } catch {
        return;
    }
};

export const remember = async <T>(key: string, ttlSeconds: number, loader: () => Promise<T>) => {
    const cached = await getCache<T>(key);

    if (cached !== null) {
        return { data: cached, cached: true };
    }

    const data = await loader();

    await setCache(key, data, ttlSeconds);

    return { data, cached: false };
};

export const setCacheHeader = (res: Response, cached: boolean) => {
    res.setHeader("X-Cache", cached ? "HIT" : "MISS");
};

export const invalidatePublicReports = () => deleteCacheByPrefix(cacheKeys.publicReportsPrefix);

export const invalidateCatalogCache = async () => {
    await Promise.all([deleteCache(cacheKeys.departments), deleteCacheByPrefix(cacheKeys.categoriesPrefix)]);
};
