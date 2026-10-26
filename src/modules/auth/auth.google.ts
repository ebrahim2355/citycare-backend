import type { TokenPayload } from "google-auth-library";
import { StatusCodes } from "http-status-codes";
import jwt from "jsonwebtoken";
import config from "../../config";
import AppError from "../../errors/AppError";
import { AuthProvider, Prisma, type Role, UserStatus } from "../../generated/prisma/client";
import getGoogleClient from "../../lib/google";
import prisma from "../../lib/prisma";
import { getReadyRedis } from "../../lib/redis";
import type { IRequestContext } from "../../utils/requestContext";
import { generateToken } from "../../utils/token";
import { safeUserSelect } from "../user/user.constant";
import { AuthService } from "./auth.service";
import type { TGoogleCallbackQuery } from "./auth.validation";

interface IGoogleProfile {
    googleId: string;
    email: string;
    name: string;
    avatarUrl: string | null;
}

interface ILoginState {
    redirect: string | null;
}

const STATE_MINUTES = 10;
const LOGIN_CODE_SECONDS = 120;
const stateSecret = `${config.jwt.accessSecret}:google-state`;
const loginCodeSecret = `${config.jwt.accessSecret}:google-login-code`;

const getAllowedRedirect = (redirect: string) => {
    const origin = new URL(redirect).origin;

    if (!config.clientOrigins.includes(origin)) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Validation failed", [
            { field: "redirect", message: "This redirect URL is not in the allowed list of the server" },
        ]);
    }

    return redirect;
};

const withQuery = (url: string, key: string, value: string) => {
    const target = new URL(url);

    target.searchParams.set(key, value);

    return target.toString();
};

const createLoginUrl = (redirect: string | undefined) => {
    const client = getGoogleClient({ needsSecret: true });
    const payload: ILoginState & { nonce: string } = {
        redirect: redirect ? getAllowedRedirect(redirect) : null,
        nonce: generateToken(8),
    };
    const state = jwt.sign(payload, stateSecret, { expiresIn: `${STATE_MINUTES}m` });

    return client.generateAuthUrl({
        access_type: "online",
        scope: ["openid", "email", "profile"],
        prompt: "select_account",
        state,
    });
};

const readState = (state: string): ILoginState => {
    try {
        const decoded = jwt.verify(state, stateSecret);

        if (typeof decoded === "string") {
            throw new Error("Invalid state");
        }

        return { redirect: typeof decoded.redirect === "string" ? decoded.redirect : null };
    } catch {
        throw new AppError(
            StatusCodes.BAD_REQUEST,
            "Google login expired",
            "The login state is invalid or expired. Start the Google login again."
        );
    }
};

const getProfileFromIdToken = async (idToken: string): Promise<IGoogleProfile> => {
    const client = getGoogleClient({ needsSecret: false });
    let payload: TokenPayload | undefined;

    try {
        const ticket = await client.verifyIdToken({ idToken, audience: config.google.clientId });

        payload = ticket.getPayload();
    } catch {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Google login failed", "The Google token is invalid or expired");
    }

    if (!payload?.sub || !payload.email) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Google login failed", "Google did not share the email of this account");
    }

    if (!payload.email_verified) {
        throw new AppError(StatusCodes.FORBIDDEN, "Google login failed", "The email of this Google account is not verified");
    }

    return {
        googleId: payload.sub,
        email: payload.email.toLowerCase(),
        name: payload.name?.trim() || (payload.email.split("@")[0] as string),
        avatarUrl: payload.picture ?? null,
    };
};

const findOrCreateUser = async (profile: IGoogleProfile) => {
    const existing = await prisma.user.findFirst({
        where: { OR: [{ googleId: profile.googleId }, { email: profile.email }] },
        select: { id: true, email: true, role: true, status: true, googleId: true, avatarUrl: true, deletedAt: true },
    });

    if (!existing) {
        try {
            return await prisma.user.create({
                data: {
                    name: profile.name,
                    email: profile.email,
                    provider: AuthProvider.GOOGLE,
                    googleId: profile.googleId,
                    avatarUrl: profile.avatarUrl,
                },
                select: { id: true, email: true, role: true },
            });
        } catch (error) {
            if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
                throw error;
            }

            return prisma.user.findUniqueOrThrow({ where: { email: profile.email }, select: { id: true, email: true, role: true } });
        }
    }

    if (existing.deletedAt) {
        throw new AppError(
            StatusCodes.UNAUTHORIZED,
            "Account is not available",
            "This account was removed. Please contact the city admin."
        );
    }

    if (existing.status === UserStatus.BLOCKED) {
        throw new AppError(StatusCodes.FORBIDDEN, "Your account is blocked", "Please contact the city admin");
    }

    if (existing.googleId && existing.googleId !== profile.googleId) {
        throw new AppError(StatusCodes.CONFLICT, "Google login failed", "This email is already linked to another Google account");
    }

    if (!existing.googleId) {
        await prisma.user.update({
            where: { id: existing.id },
            data: { googleId: profile.googleId, avatarUrl: existing.avatarUrl ?? profile.avatarUrl },
        });
    }

    return { id: existing.id, email: existing.email, role: existing.role };
};

const issueSession = async (user: { id: string; email: string; role: Role }, context: IRequestContext) => {
    const tokens = await AuthService.issueTokens(user, context);
    const safeUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: safeUserSelect });

    return { user: safeUser, ...tokens };
};

const loginWithIdToken = async (idToken: string, context: IRequestContext) => {
    const profile = await getProfileFromIdToken(idToken);
    const user = await findOrCreateUser(profile);

    return issueSession(user, context);
};

const handleCallback = async (query: TGoogleCallbackQuery, context: IRequestContext) => {
    const state = readState(query.state);

    try {
        if (query.error || !query.code) {
            throw new AppError(StatusCodes.BAD_REQUEST, "Google login was cancelled", "Google did not return a login code");
        }

        const client = getGoogleClient({ needsSecret: true });
        let idToken: string | null | undefined;

        try {
            const { tokens } = await client.getToken(query.code);

            idToken = tokens.id_token;
        } catch {
            throw new AppError(StatusCodes.UNAUTHORIZED, "Google login failed", "The Google login code is invalid or was already used");
        }

        if (!idToken) {
            throw new AppError(StatusCodes.UNAUTHORIZED, "Google login failed", "Google did not return an identity token");
        }

        const profile = await getProfileFromIdToken(idToken);
        const user = await findOrCreateUser(profile);

        if (!state.redirect) {
            return { redirectTo: null, session: await issueSession(user, context) };
        }

        const loginCode = jwt.sign({ userId: user.id, jti: generateToken(12) }, loginCodeSecret, { expiresIn: LOGIN_CODE_SECONDS });

        return { redirectTo: withQuery(state.redirect, "code", loginCode), session: null };
    } catch (error) {
        if (state.redirect && error instanceof AppError) {
            return { redirectTo: withQuery(state.redirect, "error", error.message), session: null };
        }

        throw error;
    }
};

const exchangeLoginCode = async (code: string, context: IRequestContext) => {
    let userId: string;
    let codeId: string;

    try {
        const decoded = jwt.verify(code, loginCodeSecret);

        if (typeof decoded === "string" || typeof decoded.userId !== "string" || typeof decoded.jti !== "string") {
            throw new Error("Invalid code");
        }

        userId = decoded.userId;
        codeId = decoded.jti;
    } catch {
        throw new AppError(
            StatusCodes.UNAUTHORIZED,
            "Login code is not valid",
            "The login code is invalid or expired. Start the Google login again."
        );
    }

    const redis = await getReadyRedis();

    if (redis) {
        const firstUse = await redis.set(`citycare:login-code:${codeId}`, "1", "EX", LOGIN_CODE_SECONDS + 60, "NX").catch(() => "OK");

        if (!firstUse) {
            throw new AppError(StatusCodes.UNAUTHORIZED, "Login code is not valid", "This login code was already used");
        }
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, role: true, status: true, deletedAt: true },
    });

    if (!user || user.deletedAt) {
        throw new AppError(StatusCodes.UNAUTHORIZED, "Account is not available", "This account does not exist any more");
    }

    if (user.status === UserStatus.BLOCKED) {
        throw new AppError(StatusCodes.FORBIDDEN, "Your account is blocked", "Please contact the city admin");
    }

    return issueSession(user, context);
};

export const GoogleAuthService = {
    createLoginUrl,
    handleCallback,
    loginWithIdToken,
    exchangeLoginCode,
};
