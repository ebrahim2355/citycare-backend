import type { Request, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { StatusCodes } from "http-status-codes";
import { type RedisReply, RedisStore } from "rate-limit-redis";
import config from "../config";
import getRedis from "../lib/redis";
import { getClientIp } from "../utils/clientIp";

const tooManyRequests = (_req: Request, res: Response) => {
    res.status(StatusCodes.TOO_MANY_REQUESTS).json({
        success: false,
        message: "Too many requests",
        errors: [{ message: "You have sent too many requests. Please try again later." }],
    });
};

const createStore = (name: string) => {
    const redis = getRedis();

    if (!redis) {
        return undefined;
    }

    return new RedisStore({
        prefix: `citycare:ratelimit:${name}:`,
        sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
    });
};

const createLimiter = (name: string, limit: number) => {
    const store = createStore(name);

    return rateLimit({
        windowMs: config.rateLimit.windowMinutes * 60 * 1000,
        limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        passOnStoreError: true,
        handler: tooManyRequests,
        keyGenerator: (req) => ipKeyGenerator(getClientIp(req) ?? "unknown"),
        ...(store ? { store } : {}),
    });
};

export const apiLimiter = createLimiter("api", config.rateLimit.max);

export const authLimiter = createLimiter("auth", config.rateLimit.authMax);
