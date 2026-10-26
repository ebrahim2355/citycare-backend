import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ComplaintPaymentStatus, ComplaintStatus, NotificationType, PaymentStatus } from "../../generated/prisma/client";
import logger from "../../lib/logger";
import prisma from "../../lib/prisma";
import getStripe from "../../lib/stripe";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { lockComplaint } from "../complaint/complaint.utils";
import { complaintLabel, Inbox } from "../notification/notification.inbox";
import { paymentSelect } from "./payment.constant";

export type TRefundResult = "REFUNDED" | "FAILED" | "NOT_NEEDED";

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

        const refundedComplaint = await tx.complaint.update({
            where: { id: complaint.id },
            data: { paymentStatus: ComplaintPaymentStatus.REFUNDED },
            select: { trackingCode: true, title: true },
        });

        await Inbox.notify(tx, [complaint.citizenId], {
            type: NotificationType.PAYMENT_REFUNDED,
            title: "Your service fee was refunded",
            body: `${complaintLabel(refundedComplaint)}. ${reason}`,
            complaintId: complaint.id,
        });

        await tx.complaintUpdate.create({
            data: {
                complaintId: complaint.id,
                actorId,
                fromStatus: complaint.status,
                toStatus: complaint.status,
                note: `Service fee refunded. ${reason}`,
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

const refundPayment = async (paymentId: string, actorId: string | null, reason: string, context: IRequestContext = {}) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { id: true, status: true, paymentIntentId: true, complaintId: true },
    });

    if (!payment) {
        throw new AppError(StatusCodes.NOT_FOUND, "Payment not found", "No payment found with this id");
    }

    if (payment.status !== PaymentStatus.REFUNDED) {
        if (payment.status !== PaymentStatus.COMPLETED || !payment.paymentIntentId) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Payment cannot be refunded",
                `Only a completed payment can be refunded. This one is ${payment.status}.`
            );
        }

        const refund = await getStripe().refunds.create(
            {
                payment_intent: payment.paymentIntentId,
                reason: "requested_by_customer",
                metadata: { paymentId: payment.id, complaintId: payment.complaintId },
            },
            { idempotencyKey: `citycare_refund_${payment.id}` }
        );

        await applyRefund(payment.id, refund.id, actorId, reason, context);
    }

    return prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, select: paymentSelect });
};

const refundForComplaint = async (
    complaintId: string,
    actorId: string | null,
    reason: string,
    context: IRequestContext = {}
): Promise<TRefundResult> => {
    const payment = await prisma.payment.findFirst({
        where: { complaintId, status: PaymentStatus.COMPLETED },
        select: { id: true },
    });

    if (!payment) {
        return "NOT_NEEDED";
    }

    try {
        await refundPayment(payment.id, actorId, reason, context);

        return "REFUNDED";
    } catch (error) {
        logger.error({ err: error, paymentId: payment.id }, "Refund failed");

        return "FAILED";
    }
};

const refundByAdmin = async (admin: IAuthUser, paymentId: string, context: IRequestContext) => {
    const payment = await prisma.payment.findUnique({
        where: { id: paymentId },
        select: { id: true, complaint: { select: { status: true, deletedAt: true } } },
    });

    if (!payment) {
        throw new AppError(StatusCodes.NOT_FOUND, "Payment not found", "No payment found with this id");
    }

    if (!payment.complaint.deletedAt && !REFUNDABLE_COMPLAINT_STATUSES.includes(payment.complaint.status)) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Payment cannot be refunded",
            "Reject the service request first. The fee is refunded automatically when a paid request is rejected or cancelled."
        );
    }

    return refundPayment(paymentId, admin.id, "Refunded by the admin.", context);
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
    refundForComplaint,
    refundByAdmin,
    handleRefundFromStripe,
};
