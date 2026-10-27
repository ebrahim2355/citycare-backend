import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import config from "../config";
import AppError from "../errors/AppError";

const cronAuth = (req: Request, _res: Response, next: NextFunction) => {
    if (!config.cronSecret) {
        throw new AppError(StatusCodes.SERVICE_UNAVAILABLE, "Scheduled jobs are not configured", "CRON_SECRET is missing on the server");
    }

    const received = Buffer.from(req.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${config.cronSecret}`);

    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized", "Send the cron secret as a Bearer token");
    }

    next();
};

export default cronAuth;
