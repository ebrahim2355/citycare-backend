import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { Request } from "express";
import config from "../config";

const isTrustedServer = (req: Request) => {
    const key = req.get("x-internal-key");

    if (!config.internalApiKey || !key) {
        return false;
    }

    const expected = Buffer.from(config.internalApiKey);
    const received = Buffer.from(key);

    return expected.length === received.length && timingSafeEqual(expected, received);
};

export const getClientIp = (req: Request) => {
    const forwarded = req.get("x-client-ip")?.trim();

    if (forwarded && isIP(forwarded) && isTrustedServer(req)) {
        return forwarded;
    }

    return req.ip;
};

export const getClientUserAgent = (req: Request) => {
    const forwarded = req.get("x-client-user-agent");

    if (forwarded && isTrustedServer(req)) {
        return forwarded;
    }

    return req.get("user-agent");
};
