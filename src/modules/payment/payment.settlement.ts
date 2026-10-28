import { StatusCodes } from "http-status-codes";
import type Stripe from "stripe";
import config from "../../config";
import AppError from "../../errors/AppError";
import {
    ComplaintPaymentStatus,
    ComplaintStatus,
    NotificationType,
    PaymentProvider,
    PaymentStatus,
    type Prisma,
} from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import getStripe from "../../lib/stripe";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { addHours, lockComplaint } from "../complaint/complaint.utils";
import { complaintLabel, Inbox } from "../notification/notification.inbox";
import { NotificationService } from "../notification/notification.service";
import { paymentSelect } from "./payment.constant";
import { PaymentRefund } from "./payment.refund";
import { expireStripeSession } from "./payment.utils";

export type TSettleSource = "webhook" | "callback" | "verify" | "ipn" | "checkout" | "job";

export type TSettleDetails = Pick<
    Prisma.PaymentUpdateManyMutationInput,
    "paymentIntentId" | "validationId" | "bankTransactionId" | "chargedAmount" | "chargedCurrency"
>;

type TSettleOutcome = "already_settled" | "submitted" | "too_late" | "duplicate";

const getPaymentIntentId = (session: Stripe.Checkout.Session) => {
    return typeof session.payment_intent === "string" ? session.payment_intent : (session.payment_intent?.id ?? null);
};

const findPaymentBySession = async (sessionId: string) => {
    const payment = await prisma.payment.findUnique({
        where: { transactionId: sessionId },
        select: { id: true, complaintId: true, citizenId: true, status: true },
    });

    if (!payment) {
        throw new AppError(StatusCodes.NOT_FOUND, "Payment not found", "No payment found for this checkout session");
    }

    return payment;
};

const getPayment = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id }, select: paymentSelect });

const settlePaidPayment = async (transactionId: string, details: TSettleDetails, source: TSettleSource) => {
    const payment = await prisma.payment.findUnique({
        where: { transactionId },
        select: { id: true, complaintId: true, citizenId: true, provider: true },
    });

    if (!payment) {
        return null;
    }

    const outcome = await prisma.$transaction(async (tx): Promise<TSettleOutcome> => {
        const complaint = await lockComplaint(tx, payment.complaintId, { includeDeleted: true });

        const settled = await tx.payment.updateMany({
            where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.CANCELLED, PaymentStatus.FAILED] } },
            data: { ...details, status: PaymentStatus.COMPLETED, paidAt: new Date() },
        });

        if (settled.count === 0) {
            return "already_settled";
        }

        const alreadyPaid = complaint.paymentStatus === ComplaintPaymentStatus.PAID;
        const canSubmit = !alreadyPaid && complaint.status === ComplaintStatus.PENDING_PAYMENT && !complaint.deletedAt;

        if (canSubmit) {
            const category = await tx.category.findUniqueOrThrow({ where: { id: complaint.categoryId }, select: { slaHours: true } });
            const now = new Date();

            const submitted = await tx.complaint.update({
                where: { id: complaint.id },
                data: {
                    status: ComplaintStatus.SUBMITTED,
                    paymentStatus: ComplaintPaymentStatus.PAID,
                    submittedAt: now,
                    dueAt: addHours(now, category.slaHours),
                },
                select: { trackingCode: true, title: true, area: true, department: { select: { name: true } } },
            });

            await Inbox.notify(tx, [payment.citizenId], {
                type: NotificationType.PAYMENT_RECEIVED,
                title: "Payment received",
                body: `${complaintLabel(submitted)} is paid and now with ${submitted.department.name}.`,
                complaintId: complaint.id,
            });
            await Inbox.notifyAdmins(tx, {
                type: NotificationType.COMPLAINT_SUBMITTED,
                title: "New paid request",
                body: `${complaintLabel(submitted)} in ${submitted.area}, for ${submitted.department.name}.`,
                complaintId: complaint.id,
            });

            await tx.complaintUpdate.create({
                data: {
                    complaintId: complaint.id,
                    actorId: payment.citizenId,
                    fromStatus: ComplaintStatus.PENDING_PAYMENT,
                    toStatus: ComplaintStatus.SUBMITTED,
                    note: "Service fee paid. Request submitted.",
                },
            });
        } else if (!alreadyPaid) {
            await tx.complaint.update({ where: { id: complaint.id }, data: { paymentStatus: ComplaintPaymentStatus.PAID } });
        }

        await recordAudit(tx, {
            actorId: payment.citizenId,
            action: AuditAction.PAYMENT_COMPLETED,
            entityType: AuditEntity.PAYMENT,
            entityId: payment.id,
            metadata: {
                complaintId: complaint.id,
                source,
                provider: payment.provider,
                transactionId,
                complaintStatus: complaint.status,
                ...(alreadyPaid ? { duplicate: true } : {}),
            },
        });

        return canSubmit ? "submitted" : alreadyPaid ? "duplicate" : "too_late";
    });

    if (outcome === "too_late") {
        await PaymentRefund.refundForComplaint(payment.complaintId, null, "The request was already closed when the payment arrived.");
    }

    if (outcome === "duplicate") {
        await PaymentRefund.tryRefund(payment.id, null, "The request was already paid, so this second payment was sent back.");
    }

    const settledPayment = await getPayment(payment.id);

    if (outcome === "submitted") {
        await NotificationService.paymentReceived(settledPayment);
    }

    return settledPayment;
};

const settlePaidSession = (session: Stripe.Checkout.Session, source: TSettleSource) =>
    settlePaidPayment(session.id, { paymentIntentId: getPaymentIntentId(session) }, source);

const closeUnpaidSession = async (sessionId: string, status: "CANCELLED" | "FAILED") => {
    const payment = await prisma.payment.findUnique({ where: { transactionId: sessionId }, select: { id: true, citizenId: true } });

    if (!payment) {
        return;
    }

    await prisma.$transaction(async (tx) => {
        const closed = await tx.payment.updateMany({ where: { id: payment.id, status: PaymentStatus.PENDING }, data: { status } });

        if (closed.count === 0) {
            return;
        }

        await recordAudit(tx, {
            actorId: payment.citizenId,
            action: AuditAction.PAYMENT_FAILED,
            entityType: AuditEntity.PAYMENT,
            entityId: payment.id,
            metadata: { sessionId, status },
        });
    });
};

const cancelPendingPayments = async (complaintId: string) => {
    const pendingPayments = await prisma.payment.findMany({
        where: { complaintId, status: PaymentStatus.PENDING },
        select: { transactionId: true, provider: true },
    });

    if (!pendingPayments.length) {
        return;
    }

    const stripe = config.stripe.secretKey ? getStripe() : null;

    for (const pendingPayment of pendingPayments) {
        if (stripe && pendingPayment.provider === PaymentProvider.STRIPE) {
            await expireStripeSession(stripe, pendingPayment.transactionId);
        }

        await closeUnpaidSession(pendingPayment.transactionId, "CANCELLED");
    }
};

const handleWebhook = async (rawBody: Buffer | undefined, signature: string | undefined) => {
    if (!config.stripe.webhookSecret) {
        throw new AppError(StatusCodes.SERVICE_UNAVAILABLE, "Webhook is not configured", "STRIPE_WEBHOOK_SECRET is missing on the server");
    }

    if (!rawBody || !signature) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Invalid webhook request", "The Stripe signature or the request body is missing");
    }

    let event: Stripe.Event;

    try {
        event = getStripe().webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
    } catch {
        throw new AppError(StatusCodes.BAD_REQUEST, "Invalid webhook signature", "The request was not signed by Stripe");
    }

    switch (event.type) {
        case "checkout.session.completed":
        case "checkout.session.async_payment_succeeded": {
            if (event.data.object.payment_status === "paid") {
                await settlePaidSession(event.data.object, "webhook");
            }

            break;
        }
        case "checkout.session.expired": {
            await closeUnpaidSession(event.data.object.id, "CANCELLED");
            break;
        }
        case "checkout.session.async_payment_failed": {
            await closeUnpaidSession(event.data.object.id, "FAILED");
            break;
        }
        case "charge.refunded": {
            const paymentIntent = event.data.object.payment_intent;

            await PaymentRefund.handleRefundFromStripe(
                typeof paymentIntent === "string" ? paymentIntent : (paymentIntent?.id ?? null),
                null
            );
            break;
        }
        default:
            break;
    }

    return { received: true, type: event.type };
};

const verifyPayment = async (user: IAuthUser, sessionId: string) => {
    const payment = await findPaymentBySession(sessionId);

    if (payment.citizenId !== user.id) {
        throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only verify your own payments");
    }

    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
        await settlePaidSession(session, "verify");
    }

    return { paid: session.payment_status === "paid", payment: await getPayment(payment.id) };
};

const handleSuccessCallback = async (sessionId: string) => {
    const payment = await findPaymentBySession(sessionId);
    const session = await getStripe().checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
        throw new AppError(StatusCodes.CONFLICT, "Payment is not completed", "Stripe has not received the payment for this checkout yet");
    }

    await settlePaidSession(session, "callback");

    return getPayment(payment.id);
};

const handleCancelCallback = async (sessionId: string) => {
    const payment = await findPaymentBySession(sessionId);
    const stripe = getStripe();
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid") {
        await settlePaidSession(session, "callback");

        return { paid: true, payment: await getPayment(payment.id) };
    }

    if (session.status === "open") {
        await expireStripeSession(stripe, sessionId);
    }

    await closeUnpaidSession(sessionId, "CANCELLED");

    return { paid: false, payment: await getPayment(payment.id) };
};

export const PaymentSettlement = {
    findPaymentBySession,
    getPayment,
    settlePaidPayment,
    settlePaidSession,
    closeUnpaidSession,
    cancelPendingPayments,
    handleWebhook,
    verifyPayment,
    handleSuccessCallback,
    handleCancelCallback,
};
