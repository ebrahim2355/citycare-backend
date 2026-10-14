import { OAuth2Client } from "google-auth-library";
import { StatusCodes } from "http-status-codes";
import config from "../config";
import AppError from "../errors/AppError";

let client: OAuth2Client | null = null;

const getGoogleClient = (options: { needsSecret: boolean }): OAuth2Client => {
    const { clientId, clientSecret, redirectUri } = config.google;

    if (!clientId || (options.needsSecret && !clientSecret)) {
        throw new AppError(
            StatusCodes.SERVICE_UNAVAILABLE,
            "Google login is not configured",
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are missing on the server"
        );
    }

    if (!client) {
        client = new OAuth2Client({
            clientId,
            clientSecret,
            redirectUri,
            transporterOptions: {
                fetchImplementation: (input, init) => fetch(input, init),
            },
        });
    }

    return client;
};

export default getGoogleClient;
