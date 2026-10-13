import type { Request } from "express";
import { StatusCodes } from "http-status-codes";
import AppError from "../errors/AppError";
import { type Role, UserStatus } from "../generated/prisma/client";
import prisma from "../lib/prisma";
import catchAsync from "../utils/catchAsync";
import { verifyAccessToken } from "../utils/jwt";

export interface IAuthUser {
    id: string;
    email: string;
    role: Role;
}

declare global {
    namespace Express {
        interface Request {
            user?: IAuthUser;
        }
    }
}

const auth = (...allowedRoles: Role[]) => {
    return catchAsync(async (req, _res, next) => {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith("Bearer ")) {
            throw new AppError(
                StatusCodes.UNAUTHORIZED,
                "You are not authorized",
                "Send the access token as a Bearer token in the Authorization header"
            );
        }

        const decoded = verifyAccessToken(authHeader.slice(7).trim());

        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            select: { id: true, email: true, role: true, status: true, deletedAt: true },
        });

        if (!user || user.deletedAt) {
            throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized", "The user of this token does not exist");
        }

        if (user.status === UserStatus.BLOCKED) {
            throw new AppError(StatusCodes.FORBIDDEN, "Your account is blocked", "Please contact the city admin");
        }

        if (allowedRoles.length && !allowedRoles.includes(user.role)) {
            throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You do not have permission to perform this action");
        }

        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
        };

        next();
    });
};

export const currentUser = (req: Request): IAuthUser => {
    if (!req.user) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized", "Login is required for this action");
    }

    return req.user;
};

export default auth;
