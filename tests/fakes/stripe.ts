import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import { vi } from "vitest";

interface IFakeSession {
    id: string;
    object: "checkout.session";
    url: string | null;
    status: "open" | "complete" | "expired";
    payment_status: "unpaid" | "paid";
    payment_intent: string | null;
    amount_total: number;
    currency: string;
    metadata: Record<string, string>;
    client_reference_id: string | null;
    success_url: string;
    cancel_url: string;
}

const sessions = new Map<string, IFakeSession>();
const realStripe = new Stripe("sk_test_citycare_fake_key");
let refundError: Error | null = null;

const id = (prefix: string) => `${prefix}_test_${randomBytes(12).toString("hex")}`;

const missingSession = (sessionId: string) =>
    new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: `No such checkout.session: '${sessionId}'` });

const findSession = (sessionId: string) => {
    const session = sessions.get(sessionId);

    if (!session) {
        throw missingSession(sessionId);
    }

    return session;
};

const fakeStripe = {
    checkout: {
        sessions: {
            create: vi.fn(async (params: Stripe.Checkout.SessionCreateParams) => {
                const sessionId = id("cs");
                const lineItem = params.line_items?.[0];
                const session: IFakeSession = {
                    id: sessionId,
                    object: "checkout.session",
                    url: `https://checkout.stripe.test/c/pay/${sessionId}`,
                    status: "open",
                    payment_status: "unpaid",
                    payment_intent: null,
                    amount_total: lineItem?.price_data?.unit_amount ?? 0,
                    currency: lineItem?.price_data?.currency ?? "usd",
                    metadata: (params.metadata as Record<string, string>) ?? {},
                    client_reference_id: params.client_reference_id ?? null,
                    success_url: params.success_url ?? "",
                    cancel_url: params.cancel_url ?? "",
                };

                sessions.set(sessionId, session);

                return { ...session };
            }),
            retrieve: vi.fn(async (sessionId: string) => ({ ...findSession(sessionId) })),
            expire: vi.fn(async (sessionId: string) => {
                const session = findSession(sessionId);

                if (session.status !== "open") {
                    throw new Stripe.errors.StripeInvalidRequestError({
                        type: "invalid_request_error",
                        message: "Only Checkout Sessions with a status of open can be expired.",
                    });
                }

                session.status = "expired";
                session.url = null;

                return { ...session };
            }),
        },
    },
    refunds: {
        create: vi.fn(async (params: Stripe.RefundCreateParams) => {
            if (refundError) {
                throw refundError;
            }

            return { id: id("re"), object: "refund", status: "succeeded", payment_intent: params.payment_intent ?? null };
        }),
    },
    webhooks: realStripe.webhooks,
};

const getStripe = () => fakeStripe as unknown as Stripe;

export default getStripe;

export const stripeTest = {
    client: fakeStripe,
    session: (sessionId: string) => findSession(sessionId),
    sessions: () => [...sessions.values()],
    pay: (sessionId: string) => {
        const session = findSession(sessionId);

        session.status = "complete";
        session.payment_status = "paid";
        session.payment_intent = id("pi");

        return { ...session };
    },
    expireOutsideApi: (sessionId: string) => {
        const session = findSession(sessionId);

        session.status = "expired";
        session.url = null;

        return { ...session };
    },
    failRefunds: (error: Error | null = new Stripe.errors.StripeAPIError({ type: "api_error", message: "Stripe is down" })) => {
        refundError = error;
    },
    signedEvent: (type: string, object: unknown, secret = "whsec_citycare_test_secret") => {
        const payload = JSON.stringify({
            id: id("evt"),
            object: "event",
            type,
            api_version: "2025-01-01",
            created: Math.floor(Date.now() / 1000),
            data: { object },
        });

        return { payload, signature: realStripe.webhooks.generateTestHeaderString({ payload, secret }) };
    },
    reset: () => {
        sessions.clear();
        refundError = null;
        fakeStripe.checkout.sessions.create.mockClear();
        fakeStripe.checkout.sessions.retrieve.mockClear();
        fakeStripe.checkout.sessions.expire.mockClear();
        fakeStripe.refunds.create.mockClear();
    },
};
