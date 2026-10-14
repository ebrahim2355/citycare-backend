import { StatusCodes } from "http-status-codes";
import type Stripe from "stripe";
import config from "../../config";
import AppError from "../../errors/AppError";
import { ComplaintPaymentStatus, ComplaintStatus, PaymentStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import getStripe from "../../lib/stripe";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { lockComplaint } from "../complaint/complaint.utils";
import { CHECKOUT_MINUTES, paymentSelect } from "./payment.constant";
import type { TInitiatePaymentPayload } from "./payment.validation";

const getReturnUrls = (clientUrl: string | undefined) => {
    if (!clientUrl) {
        const base = `${config.appUrl}/api/v1/payments`;

        return {
            successUrl: `${base}/success?session_id={CHECKOUT_SESSION_ID}`,
            cancelUrl: `${base}/cancel?session_id={CHECKOUT_SESSION_ID}`,
        };
    }

    const origin = clientUrl.replace(/\/$/, "");

    if (!config.clientOrigins.includes(origin)) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Validation failed", [
            { field: "clientUrl", message: "This client URL is not in the allowed list of the server" },
        ]);
    }

    return {
        successUrl: `${origin}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${origin}/payment/cancel?session_id={CHECKOUT_SESSION_ID}`,
    };
};

const expireSession = async (stripe: Stripe, sessionId: string) => {
    try {
        await stripe.checkout.sessions.expire(sessionId);
    } catch {
        return;
    }
};

const initiatePayment = async (user: IAuthUser, payload: TInitiatePaymentPayload, context: IRequestContext) => {
    const complaint = await prisma.complaint.findFirst({
        where: { id: payload.complaintId, deletedAt: null },
        select: {
            id: true,
            citizenId: true,
            status: true,
            paymentStatus: true,
            fee: true,
            trackingCode: true,
            category: { select: { name: true } },
        },
    });

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

    const { successUrl, cancelUrl } = getReturnUrls(payload.clientUrl);
    const stripe = getStripe();

    const pendingPayment = await prisma.payment.findFirst({
        where: { complaintId: complaint.id, status: PaymentStatus.PENDING },
        orderBy: { createdAt: "desc" },
        select: paymentSelect,
    });

    if (pendingPayment) {
        const openSession = await stripe.checkout.sessions.retrieve(pendingPayment.transactionId);

        if (openSession.status === "open" && openSession.url) {
            return { payment: pendingPayment, checkoutUrl: openSession.url, reused: true };
        }

        if (openSession.payment_status === "paid") {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Payment is already done",
                "This checkout was already paid. Call the verify endpoint with its session id."
            );
        }

        await prisma.payment.updateMany({
            where: { id: pendingPayment.id, status: PaymentStatus.PENDING },
            data: { status: PaymentStatus.CANCELLED },
        });
    }

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
                    transactionId: session.id,
                },
                select: paymentSelect,
            });

            await recordAudit(tx, {
                actorId: user.id,
                action: AuditAction.PAYMENT_INITIATED,
                entityType: AuditEntity.PAYMENT,
                entityId: created.id,
                metadata: { complaintId: complaint.id, amount: Number(complaint.fee), sessionId: session.id },
                ipAddress: context.ipAddress,
            });

            return created;
        });

        return { payment, checkoutUrl: session.url, reused: false };
    } catch (error) {
        await expireSession(stripe, session.id);

        throw error;
    }
};

export const PaymentCheckout = {
    initiatePayment,
    expireSession,
};
