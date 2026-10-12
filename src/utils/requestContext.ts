import type { Request } from "express";

export interface IRequestContext {
    ipAddress?: string | undefined;
    userAgent?: string | undefined;
}

export const getRequestContext = (req: Request): IRequestContext => {
    return {
        ipAddress: req.ip,
        userAgent: req.get("user-agent")?.slice(0, 250),
    };
};
