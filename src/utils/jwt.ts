import { StatusCodes } from "http-status-codes";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import config from "../config";
import AppError from "../errors/AppError";
import type { Role } from "../generated/prisma/client";

export interface ITokenPayload extends JwtPayload {
    id: string;
    email: string;
    role: Role;
}

export const createAccessToken = (payload: Pick<ITokenPayload, "id" | "email" | "role">): string => {
    return jwt.sign(payload, config.jwt.accessSecret, {
        expiresIn: config.jwt.accessExpiresIn as NonNullable<SignOptions["expiresIn"]>,
    });
};

export const verifyAccessToken = (token: string): ITokenPayload => {
    try {
        const decoded = jwt.verify(token, config.jwt.accessSecret);

        if (typeof decoded === "string") {
            throw new Error("Invalid token payload");
        }

        return decoded as ITokenPayload;
    } catch {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized", "Access token is invalid or expired");
    }
};
