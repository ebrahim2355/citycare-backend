import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { type Role, UserStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { createAccessToken } from "../../utils/jwt";
import { comparePassword, hashPassword } from "../../utils/password";
import { safeUserSelect } from "../user/user.constant";
import type { TLoginPayload, TRegisterPayload } from "./auth.validation";

interface ITokenUser {
    id: string;
    email: string;
    role: Role;
}

const issueTokens = async (user: ITokenUser) => {
    const accessToken = createAccessToken({ id: user.id, email: user.email, role: user.role });

    return { accessToken };
};

const registerUser = async (payload: TRegisterPayload) => {
    const existingUser = await prisma.user.findUnique({ where: { email: payload.email }, select: { id: true } });

    if (existingUser) {
        throw new AppError(StatusCodes.CONFLICT, "User already exists", [{ field: "email", message: "This email is already registered" }]);
    }

    const password = await hashPassword(payload.password);

    const user = await prisma.user.create({
        data: { ...payload, password },
        select: safeUserSelect,
    });

    const tokens = await issueTokens(user);

    return { user, ...tokens };
};

const loginUser = async (payload: TLoginPayload) => {
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

    const tokens = await issueTokens(user);
    const safeUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: safeUserSelect });

    return { user: safeUser, ...tokens };
};

export const AuthService = {
    issueTokens,
    registerUser,
    loginUser,
};
