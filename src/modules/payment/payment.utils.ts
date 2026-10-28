import { randomBytes } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import type Stripe from "stripe";
import config from "../../config";
import AppError from "../../errors/AppError";

export const expireStripeSession = async (stripe: Stripe, sessionId: string) => {
    try {
        await stripe.checkout.sessions.expire(sessionId);
    } catch {
        return;
    }
};

export const allowedClientOrigin = (clientUrl: string | undefined) => {
    if (!clientUrl) {
        return null;
    }

    const origin = clientUrl.replace(/\/$/, "");

    return config.clientOrigins.includes(origin) ? origin : null;
};

export const getClientOrigin = (clientUrl: string | undefined) => {
    const origin = allowedClientOrigin(clientUrl);

    if (clientUrl && !origin) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Validation failed", [
            { field: "clientUrl", message: "This client URL is not in the allowed list of the server" },
        ]);
    }

    return origin;
};

export const newSslTransactionId = () => `CC${randomBytes(12).toString("hex").toUpperCase()}`;
