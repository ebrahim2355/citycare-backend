import type { Request } from "express";
import { getClientIp, getClientUserAgent } from "./clientIp";

export interface IRequestContext {
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
}

export const getRequestContext = (req: Request): IRequestContext => {
    return {
        ipAddress: getClientIp(req),
        userAgent: getClientUserAgent(req)?.slice(0, 250),
    };
};
