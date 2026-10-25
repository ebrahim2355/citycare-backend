import { randomUUID } from "node:crypto";
import type { Request, Response } from "express";
import { pinoHttp } from "pino-http";
import logger from "../lib/logger";
import { getClientIp } from "../utils/clientIp";

const SAFE_REQUEST_ID = /^[\w.:-]{6,100}$/;
const QUIET_PATHS = new Set(["/api/v1/health/live"]);

const pathOf = (url = "") => url.split("?")[0] ?? "";

const httpLogger = pinoHttp<Request, Response>({
    logger,
    genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

        res.setHeader("X-Request-Id", id);

        return id;
    },
    autoLogging: { ignore: (req) => QUIET_PATHS.has(pathOf(req.url)) },
    customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) {
            return "error";
        }

        return res.statusCode >= 400 ? "warn" : "info";
    },
    customSuccessMessage: (req, res, responseTime) =>
        `${req.method} ${pathOf(req.originalUrl)} ${res.statusCode} ${Math.round(responseTime)}ms`,
    customErrorMessage: (req, res) => `${req.method} ${pathOf(req.originalUrl)} ${res.statusCode} failed`,
    customProps: (req) => ({ userId: req.user?.id, ip: getClientIp(req) }),
    serializers: {
        req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, url: pathOf(req.url) }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
});

export default httpLogger;
