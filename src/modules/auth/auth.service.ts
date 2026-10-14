import { StatusCodes } from "http-status-codes";
import config from "../../config";
import AppError from "../../errors/AppError";
import { type Role, UserStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { recordAudit } from "../../utils/auditLog";
import { createAccessToken } from "../../utils/jwt";
import { comparePassword, hashPassword } from "../../utils/password";
import type { IRequestContext } from "../../utils/requestContext";
import { generateToken, hashToken } from "../../utils/token";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { NotificationService } from "../notification/notification.service";
import { safeUserSelect } from "../user/user.constant";
import type { TChangePasswordPayload, TLoginPayload, TRegisterPayload, TResetPasswordPayload } from "./auth.validation";

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

const changePassword = async (userId: string, payload: TChangePasswordPayload, context: IRequestContext) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    if (user.password) {
        const isPasswordMatched = payload.currentPassword ? await comparePassword(payload.currentPassword, user.password) : false;

        if (!isPasswordMatched) {
            throw new AppError(StatusCodes.BAD_REQUEST, "Current password is incorrect", [
                { field: "currentPassword", message: "Current password is incorrect" },
            ]);
        }
    }

    const password = await hashPassword(payload.newPassword);

    await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: { password } }),
        prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
        recordAudit(prisma, {
            actorId: userId,
            action: AuditAction.PASSWORD_CHANGED,
            entityType: AuditEntity.USER,
            entityId: userId,
            ipAddress: context.ipAddress,
        }),
    ]);

    return issueTokens(user, context);
};

const requestPasswordReset = async (email: string) => {
    const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, name: true, email: true, status: true, deletedAt: true },
    });

    if (!user || user.deletedAt || user.status === UserStatus.BLOCKED) {
        return { resetToken: null };
    }

    const token = generateToken(32);

    await prisma.user.update({
        where: { id: user.id },
        data: {
            resetTokenHash: hashToken(token),
            resetTokenExpiresAt: new Date(Date.now() + config.resetTokenMinutes * 60 * 1000),
        },
    });

    const sent = await NotificationService.passwordReset(user, token);

    return { resetToken: !sent && !config.isProduction ? token : null };
};

const resetPassword = async (payload: TResetPasswordPayload, context: IRequestContext) => {
    const user = await prisma.user.findUnique({
        where: { resetTokenHash: hashToken(payload.token) },
        select: { id: true, status: true, deletedAt: true, resetTokenExpiresAt: true },
    });

    if (!user || user.deletedAt || !user.resetTokenExpiresAt || user.resetTokenExpiresAt < new Date()) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Reset token is not valid", [
            { field: "token", message: "The reset token is invalid or expired. Request a new one." },
        ]);
    }

    if (user.status === UserStatus.BLOCKED) {
        throw new AppError(StatusCodes.FORBIDDEN, "Your account is blocked", "Please contact the city admin");
    }

    const password = await hashPassword(payload.newPassword);

    await prisma.$transaction([
        prisma.user.update({
            where: { id: user.id },
            data: { password, resetTokenHash: null, resetTokenExpiresAt: null },
        }),
        prisma.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } }),
        recordAudit(prisma, {
            actorId: user.id,
            action: AuditAction.PASSWORD_RESET,
            entityType: AuditEntity.USER,
            entityId: user.id,
            ipAddress: context.ipAddress,
        }),
    ]);
};

export const AuthService = {
    issueTokens,
    registerUser,
    loginUser,
    refreshAccessToken,
    logoutUser,
    changePassword,
    requestPasswordReset,
    resetPassword,
};
