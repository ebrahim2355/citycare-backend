import { StatusCodes } from "http-status-codes";
import Stripe from "stripe";
import config from "../config";
import AppError from "../errors/AppError";

let stripeClient: Stripe | null = null;

const getStripe = (): Stripe => {
    if (!config.stripe.secretKey) {
        throw new AppError(StatusCodes.SERVICE_UNAVAILABLE, "Payment is not configured", "STRIPE_SECRET_KEY is missing on the server");
    }

    if (!stripeClient) {
        stripeClient = new Stripe(config.stripe.secretKey, { maxNetworkRetries: 2 });
    }

    return stripeClient;
};

export default getStripe;
