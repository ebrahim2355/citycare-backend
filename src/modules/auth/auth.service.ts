import { StatusCodes } from "http-status-codes";
import config from "../../config";
import AppError from "../../errors/AppError";
import { type Role, UserStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { createAccessToken } from "../../utils/jwt";
import { comparePassword, hashPassword } from "../../utils/password";
import type { IRequestContext } from "../../utils/requestContext";
import { generateToken, hashToken } from "../../utils/token";
import { safeUserSelect } from "../user/user.constant";
import type { TLoginPayload, TRegisterPayload } from "./auth.validation";

interface ITokenUser {
    id: string;
    email: string;
    role: Role;
}

const REUSE_GRACE_MS = 10 * 1000;

const issueTokens = async (user: ITokenUser, context: IRequestContext = {}) => {
    const accessToken = createAccessToken({ id: user.id, email: user.email, role: user.role });
    const refreshToken = generateToken();

    await prisma.refreshToken.create({
        data: {
            tokenHash: hashToken(refreshToken),
            userId: user.id,
            expiresAt: new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000),
            userAgent: context.userAgent ?? null,
            ipAddress: context.ipAddress ?? null,
        },
    });

    return { accessToken, refreshToken };
};

const registerUser = async (payload: TRegisterPayload, context: IRequestContext) => {
    const existingUser = await prisma.user.findUnique({ where: { email: payload.email }, select: { id: true } });

    if (existingUser) {
        throw new AppError(StatusCodes.CONFLICT, "User already exists", [{ field: "email", message: "This email is already registered" }]);
    }

    const password = await hashPassword(payload.password);

    const user = await prisma.user.create({
        data: { ...payload, password },
        select: safeUserSelect,
    });

    const tokens = await issueTokens(user, context);

    return { user, ...tokens };
};

const loginUser = async (payload: TLoginPayload, context: IRequestContext) => {
    const user = await prisma.user.findUnique({ where: { email: payload.email } });

    if (!user || user.deletedAt) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid credentials", "Email or password is incorrect");
    }

    if (!user.password) {
        throw new AppError(
            StatusCodes.BAD_REQUEST,
            "Password login is not available",
            "This account was created with Google. Login with Google instead."
        );
    }

    const isPasswordMatched = await comparePassword(payload.password, user.password);

    if (!isPasswordMatched) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid credentials", "Email or password is incorrect");
    }

    if (user.status === UserStatus.BLOCKED) {
        throw new AppError(StatusCodes.FORBIDDEN, "Your account is blocked", "Please contact the city admin");
    }

    await prisma.refreshToken.deleteMany({ where: { userId: user.id, expiresAt: { lt: new Date() } } });

    const tokens = await issueTokens(user, context);
    const safeUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: safeUserSelect });

    return { user: safeUser, ...tokens };
};

const refreshAccessToken = async (refreshToken: string, context: IRequestContext) => {
    const storedToken = await prisma.refreshToken.findUnique({
        where: { tokenHash: hashToken(refreshToken) },
        include: { user: { select: { id: true, email: true, role: true, status: true, deletedAt: true } } },
    });

    if (!storedToken) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Invalid refresh token", "Please login again");
    }

    if (storedToken.revokedAt) {
        if (Date.now() - storedToken.revokedAt.getTime() > REUSE_GRACE_MS) {
            await prisma.refreshToken.updateMany({
                where: { userId: storedToken.userId, revokedAt: null },
                data: { revokedAt: new Date() },
            });
        }

        throw new AppError(StatusCodes.UNAUTHORIZED, "Refresh token was already used", "Please login again");
    }

    if (storedToken.expiresAt < new Date()) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Refresh token has expired", "Please login again");
    }

    if (storedToken.user.deletedAt) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "You are not authorized", "This account does not exist any more");
    }

    if (storedToken.user.status === UserStatus.BLOCKED) {
        throw new AppError(StatusCodes.FORBIDDEN, "Your account is blocked", "Please contact the city admin");
    }

    const revoked = await prisma.refreshToken.updateMany({
        where: { id: storedToken.id, revokedAt: null },
        data: { revokedAt: new Date() },
    });

    if (revoked.count === 0) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Refresh token was already used", "Please login again");
    }

    return issueTokens(storedToken.user, context);
};

const logoutUser = async (refreshToken: string) => {
    await prisma.refreshToken.updateMany({
        where: { tokenHash: hashToken(refreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
    });
};

export const AuthService = {
    issueTokens,
    registerUser,
    loginUser,
    refreshAccessToken,
    logoutUser,
};
