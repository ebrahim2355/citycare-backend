import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import {
    ComplaintPaymentStatus,
    ComplaintStatus,
    NotificationType,
    type PaymentMethod,
    PaymentProvider,
    PaymentStatus,
    type Prisma,
} from "../../generated/prisma/client";
import logger from "../../lib/logger";
import prisma from "../../lib/prisma";
import getSslCommerz from "../../lib/sslcommerz";
import getStripe from "../../lib/stripe";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { lockComplaint } from "../complaint/complaint.utils";
import { complaintLabel, Inbox } from "../notification/notification.inbox";
import { METHOD_LABELS, paymentSelect } from "./payment.constant";

export type TRefundResult = "REFUNDED" | "FAILED" | "NOT_NEEDED";

interface IRefundablePayment {
    id: string;
    complaintId: string;
    method: PaymentMethod;
    transactionId: string;
    paymentIntentId: string | null;
    bankTransactionId: string | null;
    chargedAmount: Prisma.Decimal | null;
}

const REFUNDABLE_COMPLAINT_STATUSES: ComplaintStatus[] = [ComplaintStatus.REJECTED, ComplaintStatus.CANCELLED];

const applyRefund = async (
    paymentId: string,
    refundId: string | null,
    actorId: string | null,
    reason: string,
    context: IRequestContext = {}
) => {
    await prisma.$transaction(async (tx) => {
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, select: { complaintId: true } });
        const complaint = await lockComplaint(tx, payment.complaintId, { includeDeleted: true });

        const refunded = await tx.payment.updateMany({
            where: { id: paymentId, status: PaymentStatus.COMPLETED },
            data: { status: PaymentStatus.REFUNDED, refundId, refundedAt: new Date() },
        });

        if (refunded.count === 0) {
            return;
        }

        const stillPaid = await tx.payment.count({ where: { complaintId: complaint.id, status: PaymentStatus.COMPLETED } });

        const refundedComplaint = await tx.complaint.update({
            where: { id: complaint.id },
            data: stillPaid ? {} : { paymentStatus: ComplaintPaymentStatus.REFUNDED },
            select: { trackingCode: true, title: true },
        });

        await Inbox.notify(tx, [complaint.citizenId], {
            type: NotificationType.PAYMENT_REFUNDED,
            title: stillPaid ? "Your extra payment was refunded" : "Your service fee was refunded",
            body: `${complaintLabel(refundedComplaint)}. ${reason}`,
            complaintId: complaint.id,
        });

        await tx.complaintUpdate.create({
            data: {
                complaintId: complaint.id,
                actorId,
                fromStatus: complaint.status,
                toStatus: complaint.status,
                note: `${stillPaid ? "Extra payment refunded." : "Service fee refunded."} ${reason}`,
            },
        });

        await recordAudit(tx, {
            actorId,
            action: AuditAction.PAYMENT_REFUNDED,
            entityType: AuditEntity.PAYMENT,
            entityId: paymentId,
            metadata: { complaintId: complaint.id, refundId, reason },
            ipAddress: context.ipAddress,
        });
    });
};

const notRefundable = (detail: string) => new AppError(StatusCodes.CONFLICT, "Payment cannot be refunded", detail);

const refundWithStripe = async (payment: IRefundablePayment) => {
    if (!payment.paymentIntentId) {
        throw notRefundable("This card payment has no Stripe payment intent to refund.");
    }

    const refund = await getStripe().refunds.create(
        {
            payment_intent: payment.paymentIntentId,
            reason: "requested_by_customer",
            metadata: { paymentId: payment.id, complaintId: payment.complaintId },
        },
        { idempotencyKey: `citycare_refund_${payment.id}` }
    );

    return refund.id;
};

const refundWithSslCommerz = async (payment: IRefundablePayment, reason: string) => {
    if (!payment.bankTransactionId || !payment.chargedAmount) {
        throw notRefundable(`This ${METHOD_LABELS[payment.method]} payment has no SSLCommerz bank transaction to refund.`);
    }

    const refund = await getSslCommerz().refund({
        bankTransactionId: payment.bankTransactionId,
        refundTransactionId: `R${payment.transactionId}`,
        amount: payment.chargedAmount.toFixed(2),
        remarks: reason.slice(0, 200),
        referenceId: payment.id,
    });

    if (refund.status === "failed" || !refund.refund_ref_id) {
        throw new AppError(
            StatusCodes.BAD_GATEWAY,
            "Refund failed",
            `SSLCommerz did not refund the ${METHOD_LABELS[payment.method]} payment. ${refund.errorReason || "Please try again later."}`
        );
    }

    return refund.refund_ref_id;
};

const refundPayment = async (paymentId: string, actorId: string | null, reason: string, context: IRequestContext = {}) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: {
            id: true,
            status: true,
            complaintId: true,
            provider: true,
            method: true,
            transactionId: true,
            paymentIntentId: true,
            bankTransactionId: true,
            chargedAmount: true,
        },
    });

    if (!payment) {
        throw new AppError(StatusCodes.NOT_FOUND, "Payment not found", "No payment found with this id");
    }

    if (payment.status !== PaymentStatus.REFUNDED) {
        if (payment.status !== PaymentStatus.COMPLETED) {
            throw notRefundable(`Only a completed payment can be refunded. This one is ${payment.status}.`);
        }

        const refundId =
            payment.provider === PaymentProvider.SSLCOMMERZ ? await refundWithSslCommerz(payment, reason) : await refundWithStripe(payment);

        await applyRefund(payment.id, refundId, actorId, reason, context);
    }

    return prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: paymentSelect });
};

const tryRefund = async (
    paymentId: string,
    actorId: string | null,
    reason: string,
    context: IRequestContext = {}
): Promise<Exclude<TRefundResult, "NOT_NEEDED">> => {
    try {
        await refundPayment(paymentId, actorId, reason, context);

        return "REFUNDED";
    } catch (error) {
        logger.error({ err: error, paymentId }, "Refund failed");

        return "FAILED";
    }
};

const refundForComplaint = async (
    complaintId: string,
    actorId: string | null,
    reason: string,
    context: IRequestContext = {}
): Promise<TRefundResult> => {
    const payments = await prisma.payment.findMany({
        where: { complaintId, status: PaymentStatus.COMPLETED },
        orderBy: { paidAt: "asc" },
        select: { id: true },
    });

    if (!payments.length) {
        return "NOT_NEEDED";
    }

    let result: TRefundResult = "REFUNDED";

    for (const payment of payments) {
        if ((await tryRefund(payment.id, actorId, reason, context)) === "FAILED") {
            result = "FAILED";
        }
    }

    return result;
};

const refundByAdmin = async (admin: IAuthUser, paymentId: string, context: IRequestContext) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { id: true, complaintId: true, status: true, complaint: { select: { status: true, deletedAt: true } } },
    });

    if (!payment) {
        throw new AppError(StatusCodes.NOT_FOUND, "Payment not found", "No payment found with this id");
    }

    const otherPaid = await prisma.payment.count({
        where: { complaintId: payment.complaintId, status: PaymentStatus.COMPLETED, id: { not: payment.id } },
    });
    const isExtra = payment.status === PaymentStatus.COMPLETED && otherPaid > 0;

    if (!isExtra && !payment.complaint.deletedAt && !REFUNDABLE_COMPLAINT_STATUSES.includes(payment.complaint.status)) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Payment cannot be refunded",
            "Reject the service request first. The fee is refunded automatically when a paid request is rejected or cancelled."
        );
    }

    return refundPayment(
        paymentId,
        admin.id,
        isExtra ? "The request was paid twice. Refunded by the admin." : "Refunded by the admin.",
        context
    );
};

const handleRefundFromStripe = async (paymentIntentId: string | null, refundId: string | null) => {
    if (!paymentIntentId) {
        return;
    }

    const payment = await prisma.payment.findFirst({
        where: { paymentIntentId, status: PaymentStatus.COMPLETED },
        select: { id: true },
    });

    if (payment) {
        await applyRefund(payment.id, refundId, null, "Refunded from the Stripe dashboard.");
    }
};

export const PaymentRefund = {
    refundPayment,
    tryRefund,
    refundForComplaint,
    refundByAdmin,
    handleRefundFromStripe,
};
