import { StatusCodes } from "http-status-codes";
import type Stripe from "stripe";
import config from "../../config";
import AppError from "../../errors/AppError";
import { ComplaintPaymentStatus, ComplaintStatus, PaymentMethod, PaymentProvider, PaymentStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import getSslCommerz from "../../lib/sslcommerz";
import getStripe from "../../lib/stripe";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { lockComplaint } from "../complaint/complaint.utils";
import { CHECKOUT_MINUTES, PROVIDER_BY_METHOD, paymentSelect } from "./payment.constant";
import { PaymentSettlement } from "./payment.settlement";
import { PaymentSslCommerz } from "./payment.sslcommerz";
import { expireStripeSession, getClientOrigin, newSslTransactionId } from "./payment.utils";
import type { TInitiatePaymentPayload } from "./payment.validation";

const complaintSelect = {
    id: true,
    citizenId: true,
    status: true,
    paymentStatus: true,
    fee: true,
    trackingCode: true,
    category: { select: { name: true } },
} as const;

type TPayableComplaint = NonNullable<Awaited<ReturnType<typeof findPayableComplaint>>>;

const findPayableComplaint = (complaintId: string) =>
    prisma.complaint.findFirst({ where: { id: complaintId, deletedAt: null }, select: complaintSelect });

const getStripeReturnUrls = (clientOrigin: string | null) => {
    if (!clientOrigin) {
        const base = `${config.appUrl}/api/v1/payments`;

        return {
            successUrl: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${base}/cancel?session_id={CHECKOUT_SESSION_ID}`,
        };
    }

    return {
        successUrl: `${clientOrigin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${clientOrigin}/payment/cancel?session_id={CHECKOUT_SESSION_ID}`,
    };
};

const assertPayable = (complaint: TPayableComplaint | null, user: IAuthUser): TPayableComplaint => {
    if (!complaint) {
        throw new AppError(StatusCodes.NOT_FOUND, "Complaint not found", "No complaint found with this id");
    }

    if (complaint.citizenId !== user.id) {
        throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only pay for your own service requests");
    }

    if (complaint.paymentStatus === ComplaintPaymentStatus.NOT_REQUIRED) {
        throw new AppError(StatusCodes.CONFLICT, "Payment is not needed", "This complaint has no service fee");
    }

    if (complaint.paymentStatus !== ComplaintPaymentStatus.UNPAID) {
        throw new AppError(StatusCodes.CONFLICT, "Payment is already done", "The service fee of this request was already paid");
    }

    if (complaint.status !== ComplaintStatus.PENDING_PAYMENT) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Payment is not possible",
            `This request is ${complaint.status}, so it can no longer be paid`
        );
    }

    return complaint;
};

const closeOrReusePending = async (pending: { transactionId: string; provider: PaymentProvider }, method: PaymentMethod) => {
    if (pending.provider === PaymentProvider.SSLCOMMERZ) {
        await PaymentSslCommerz.closeForNewCheckout(pending.transactionId);

        return null;
    }

    const stripe = getStripe();
    const openSession = await stripe.checkout.sessions.retrieve(pending.transactionId);

    if (openSession.status === "open" && openSession.url && method === PaymentMethod.CARD) {
        return openSession.url;
    }

    if (openSession.payment_status === "paid") {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Payment is already done",
            "This checkout was already paid. Call the verify endpoint with its session id."
        );
    }

    if (openSession.status === "open") {
        await expireStripeSession(stripe, pending.transactionId);
    }

    await PaymentSettlement.closeUnpaidSession(pending.transactionId, "CANCELLED");

    return null;
};

const openStripeCheckout = async (stripe: Stripe, user: IAuthUser, complaint: TPayableComplaint, clientOrigin: string | null) => {
    const { successUrl, cancelUrl } = getStripeReturnUrls(clientOrigin);
    const metadata = { complaintId: complaint.id, citizenId: user.id, trackingCode: complaint.trackingCode };

    const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: user.email,
        client_reference_id: complaint.id,
        line_items: [
            {
                quantity: 1,
                price_data: {
                    currency: config.stripe.currency,
                    unit_amount: Math.round(Number(complaint.fee) * 100),
                    product_data: {
                        name: `${complaint.category.name} service fee`,
                        description: `CityCare request ${complaint.trackingCode}`,
                    },
                },
            },
        ],
        metadata,
        payment_intent_data: { metadata },
        expires_at: Math.floor(Date.now() / 1000) + CHECKOUT_MINUTES * 60,
        success_url: successUrl,
        cancel_url: cancelUrl,
    });

    if (!session.url) {
        throw new AppError(StatusCodes.BAD_GATEWAY, "Payment provider error", "Stripe did not return a checkout URL");
    }

    return { transactionId: session.id, checkoutUrl: session.url };
};

const openSslCheckout = async (user: IAuthUser, complaint: TPayableComplaint, method: PaymentMethod, clientOrigin: string | null) => {
    const citizen = await prisma.user.findUniqueOrThrow({
        where: { id: user.id },
        select: { name: true, email: true, phone: true, address: true },
    });
    const transactionId = newSslTransactionId();
    const checkoutUrl = await PaymentSslCommerz.createCheckout({ tranId: transactionId, method, clientOrigin, citizen, complaint });

    return { transactionId, checkoutUrl };
};

const initiatePayment = async (user: IAuthUser, payload: TInitiatePaymentPayload, context: IRequestContext) => {
    const complaint = assertPayable(await findPayableComplaint(payload.complaintId), user);
    const method = payload.method;
    const provider = PROVIDER_BY_METHOD[method];
    const clientOrigin = getClientOrigin(payload.clientUrl);
    const stripe = provider === PaymentProvider.STRIPE ? getStripe() : null;

    if (!stripe) {
        getSslCommerz();
    }

    const pendingPayment = await prisma.payment.findFirst({
        where: { complaintId: complaint.id, status: PaymentStatus.PENDING },
        orderBy: { createdAt: "desc" },
        select: paymentSelect,
    });

    if (pendingPayment) {
        const openUrl = await closeOrReusePending(pendingPayment, method);

        if (openUrl) {
            return { payment: pendingPayment, checkoutUrl: openUrl, reused: true };
        }
    }

    const checkout = stripe
        ? await openStripeCheckout(stripe, user, complaint, clientOrigin)
        : await openSslCheckout(user, complaint, method, clientOrigin);

    try {
        const payment = await prisma.$transaction(async (tx) => {
            const locked = await lockComplaint(tx, complaint.id);

            if (locked.status !== ComplaintStatus.PENDING_PAYMENT) {
                throw new AppError(
                    StatusCodes.CONFLICT,
                    "Payment is not possible",
                    `This request is ${locked.status}, so it can no longer be paid`
                );
            }

            const otherPending = await tx.payment.findFirst({
                where: { complaintId: complaint.id, status: PaymentStatus.PENDING },
                select: { id: true },
            });

            if (otherPending) {
                throw new AppError(
                    StatusCodes.CONFLICT,
                    "A payment is already in progress",
                    "Another checkout was started for this request a moment ago. Send the request again to get its link."
                );
            }

            const created = await tx.payment.create({
                data: {
                    complaintId: complaint.id,
                    citizenId: user.id,
                    amount: complaint.fee,
                    currency: config.stripe.currency,
                    provider,
                    method,
                    transactionId: checkout.transactionId,
                },
                select: paymentSelect,
            });

            await recordAudit(tx, {
                actorId: user.id,
                action: AuditAction.PAYMENT_INITIATED,
                entityType: AuditEntity.PAYMENT,
                entityId: created.id,
                metadata: {
                    complaintId: complaint.id,
                    amount: Number(complaint.fee),
                    provider,
                    method,
                    transactionId: checkout.transactionId,
                },
                ipAddress: context.ipAddress,
            });

            return created;
        });

        return { payment, checkoutUrl: checkout.checkoutUrl, reused: false };
    } catch (error) {
        if (stripe) {
            await expireStripeSession(stripe, checkout.transactionId);
        }

        throw error;
    }
};

export const PaymentCheckout = {
    initiatePayment,
};
