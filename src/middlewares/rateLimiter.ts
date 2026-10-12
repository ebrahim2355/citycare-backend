import type { Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { StatusCodes } from "http-status-codes";
import config from "../config";

const tooManyRequests = (_req: Request, res: Response) => {
    res.status(StatusCodes.TOO_MANY_REQUESTS).json({
        success: false,
        message: "Too many requests",
        errors: [{ message: "You have sent too many requests. Please try again later." }],
    });
};

const createLimiter = (limit: number) => {
    return rateLimit({
        windowMs: config.rateLimit.windowMinutes * 60 * 1000,
        limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: tooManyRequests,
    });
};

export const apiLimiter = createLimiter(config.rateLimit.max);

export const authLimiter = createLimiter(config.rateLimit.authMax);
