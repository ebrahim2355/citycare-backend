import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import prisma from "../lib/prisma";
import catchAsync from "../utils/catchAsync";
import sendResponse from "../utils/sendResponse";

const router = Router();

router.get(
    "/health",
    catchAsync(async (_req, res) => {
        await prisma.$queryRaw`SELECT 1`;

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            message: "API is healthy",
            data: { database: "up", uptime: Math.round(process.uptime()) },
        });
    })
);

export default router;
