import { StatusCodes } from "http-status-codes";
import config from "../../config";
import AppError from "../../errors/AppError";
import { ComplaintStatus, type Prisma, Role, UserStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { PaymentRefund, type TRefundResult } from "../payment/payment.refund";
import { PaymentSettlement } from "../payment/payment.settlement";
import { CITIZEN_EDITABLE_STATUSES, FEEDBACK_STATUSES, OPEN_STATUSES } from "./complaint.constant";
import { addHours, getComplaintDetail, lockComplaint } from "./complaint.utils";
import type {
    TCancelComplaintPayload,
    TChangeStatusPayload,
    TFeedbackPayload,
    TReopenComplaintPayload,
    TTransferComplaintPayload,
} from "./complaint.validation";

type TTransitionMap = Partial<Record<ComplaintStatus, ComplaintStatus[]>>;

const STAFF_TRANSITIONS: TTransitionMap = {
    [ComplaintStatus.ASSIGNED]: [ComplaintStatus.IN_PROGRESS],
    [ComplaintStatus.IN_PROGRESS]: [ComplaintStatus.RESOLVED],
};

const ADMIN_TRANSITIONS: TTransitionMap = {
    [ComplaintStatus.PENDING_PAYMENT]: [ComplaintStatus.REJECTED],
    [ComplaintStatus.SUBMITTED]: [ComplaintStatus.REJECTED],
    [ComplaintStatus.ASSIGNED]: [ComplaintStatus.REJECTED],
    [ComplaintStatus.IN_PROGRESS]: [ComplaintStatus.REJECTED],
    [ComplaintStatus.RESOLVED]: [ComplaintStatus.CLOSED],
};

const closePayments = async (id: string, actorId: string, reason: string, context: IRequestContext) => {
    await PaymentSettlement.cancelPendingPayments(id);

    const refund = await PaymentRefund.refundForComplaint(id, actorId, reason, context);
    const complaint = await getComplaintDetail(prisma, id);

    return { complaint, refund };
};

const changeStatus = async (user: IAuthUser, id: string, payload: TChangeStatusPayload, context: IRequestContext) => {
    const updated = await prisma.$transaction(async (tx) => {
        const complaint = await lockComplaint(tx, id);

        if (user.role === Role.STAFF && complaint.assignedStaffId !== user.id) {
            throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "This complaint is not assigned to you");
        }

        const transitions = user.role === Role.STAFF ? STAFF_TRANSITIONS : ADMIN_TRANSITIONS;
        const allowed = transitions[complaint.status] ?? [];

        if (!allowed.includes(payload.status)) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Status change is not allowed",
                `${user.role === Role.STAFF ? "Staff" : "Admin"} cannot change a complaint from ${complaint.status} to ${payload.status}. Allowed next status: ${allowed.join(", ") || "none"}.`
            );
        }

        const now = new Date();
        const data: Prisma.ComplaintUpdateInput = { status: payload.status };

        if (payload.status === ComplaintStatus.RESOLVED) {
            data.resolvedAt = now;
            data.resolutionNote = payload.note ?? null;
        }

        if (payload.status === ComplaintStatus.REJECTED) {
            data.rejectionReason = payload.note ?? null;
            data.closedAt = now;
        }

        if (payload.status === ComplaintStatus.CLOSED) {
            data.closedAt = now;
        }

        await tx.complaint.update({ where: { id }, data });

        await tx.complaintUpdate.create({
            data: {
                complaintId: id,
                actorId: user.id,
                fromStatus: complaint.status,
                toStatus: payload.status,
                note: payload.note ?? null,
            },
        });

        await recordAudit(tx, {
            actorId: user.id,
            action: AuditAction.COMPLAINT_STATUS_CHANGED,
            entityType: AuditEntity.COMPLAINT,
            entityId: id,
            metadata: { from: complaint.status, to: payload.status },
            ipAddress: context.ipAddress,
        });

        return getComplaintDetail(tx, id);
    });

    if (payload.status !== ComplaintStatus.REJECTED) {
        return { complaint: updated, refund: "NOT_NEEDED" as TRefundResult };
    }

    return closePayments(id, user.id, "The request was rejected.", context);
};

const cancelComplaint = async (user: IAuthUser, id: string, payload: TCancelComplaintPayload, context: IRequestContext) => {
    await prisma.$transaction(async (tx) => {
        const complaint = await lockComplaint(tx, id);

        if (complaint.citizenId !== user.id) {
            throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only cancel your own complaints");
        }

        if (!CITIZEN_EDITABLE_STATUSES.includes(complaint.status)) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Complaint cannot be cancelled",
                `A complaint can be cancelled only before it is assigned. This one is ${complaint.status}.`
            );
        }

        await tx.complaint.update({
            where: { id },
            data: { status: ComplaintStatus.CANCELLED, closedAt: new Date() },
        });

        await tx.complaintUpdate.create({
            data: {
                complaintId: id,
                actorId: user.id,
                fromStatus: complaint.status,
                toStatus: ComplaintStatus.CANCELLED,
                note: payload.reason ?? "Cancelled by the citizen",
            },
        });

        await recordAudit(tx, {
            actorId: user.id,
            action: AuditAction.COMPLAINT_CANCELLED,
            entityType: AuditEntity.COMPLAINT,
            entityId: id,
            metadata: { from: complaint.status },
            ipAddress: context.ipAddress,
        });
    });

    return closePayments(id, user.id, "The request was cancelled by the citizen.", context);
};

const reopenComplaint = async (user: IAuthUser, id: string, payload: TReopenComplaintPayload, context: IRequestContext) => {
    const { reopenWindowDays, maxReopens } = config.complaint;

    return prisma.$transaction(async (tx) => {
        const complaint = await lockComplaint(tx, id);

        if (complaint.citizenId !== user.id) {
            throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only reopen your own complaints");
        }

        if (complaint.status !== ComplaintStatus.RESOLVED) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Complaint cannot be reopened",
                `Only a resolved complaint can be reopened. This one is ${complaint.status}.`
            );
        }

        const details = await tx.complaint.findUniqueOrThrow({
            where: { id },
            select: {
                resolvedAt: true,
                reopenCount: true,
                category: { select: { slaHours: true } },
                assignedStaff: { select: { id: true, role: true, status: true, departmentId: true, deletedAt: true } },
            },
        });

        if (details.reopenCount >= maxReopens) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Complaint cannot be reopened",
                `A complaint can be reopened ${maxReopens} times at most. Please submit a new complaint.`
            );
        }

        const now = new Date();
        const windowEnd = details.resolvedAt ? addHours(details.resolvedAt, reopenWindowDays * 24) : now;

        if (windowEnd < now) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Complaint cannot be reopened",
                `A complaint can be reopened within ${reopenWindowDays} days after it is resolved`
            );
        }

        const staff = details.assignedStaff;
        const staffIsAvailable = Boolean(
            staff &&
                !staff.deletedAt &&
                staff.role === Role.STAFF &&
                staff.status === UserStatus.ACTIVE &&
                staff.departmentId === complaint.departmentId
        );
        const nextStatus = staffIsAvailable ? ComplaintStatus.IN_PROGRESS : ComplaintStatus.SUBMITTED;

        await tx.complaint.update({
            where: { id },
            data: {
                status: nextStatus,
                resolvedAt: null,
                resolutionNote: null,
                dueAt: addHours(now, details.category.slaHours),
                reopenCount: { increment: 1 },
                ...(staffIsAvailable ? {} : { assignedStaffId: null, assignedAt: null }),
            },
        });

        await tx.complaintUpdate.create({
            data: {
                complaintId: id,
                actorId: user.id,
                fromStatus: complaint.status,
                toStatus: nextStatus,
                note: `Reopened by the citizen: ${payload.reason}`,
            },
        });

        await recordAudit(tx, {
            actorId: user.id,
            action: AuditAction.COMPLAINT_REOPENED,
            entityType: AuditEntity.COMPLAINT,
            entityId: id,
            metadata: { to: nextStatus, reopenCount: details.reopenCount + 1 },
            ipAddress: context.ipAddress,
        });

        return getComplaintDetail(tx, id);
    });
};

const transferComplaint = async (user: IAuthUser, id: string, payload: TTransferComplaintPayload, context: IRequestContext) => {
    return prisma.$transaction(async (tx) => {
        const complaint = await lockComplaint(tx, id);

        if (!OPEN_STATUSES.includes(complaint.status)) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Complaint cannot be transferred",
                `Only submitted, assigned or in progress complaints can be transferred. This one is ${complaint.status}.`
            );
        }

        if (complaint.departmentId === payload.departmentId) {
            throw new AppError(StatusCodes.CONFLICT, "Complaint cannot be transferred", "The complaint is already in this department");
        }

        const department = await tx.department.findFirst({
            where: { id: payload.departmentId, deletedAt: null },
            select: { id: true, name: true },
        });

        if (!department) {
            throw new AppError(StatusCodes.BAD_REQUEST, "Department not found", [
                { field: "departmentId", message: "No department found with this id" },
            ]);
        }

        await tx.complaint.update({
            where: { id },
            data: {
                departmentId: department.id,
                assignedStaffId: null,
                assignedAt: null,
                status: ComplaintStatus.SUBMITTED,
            },
        });

        await tx.complaintUpdate.create({
            data: {
                complaintId: id,
                actorId: user.id,
                fromStatus: complaint.status,
                toStatus: ComplaintStatus.SUBMITTED,
                note: payload.note ? `Transferred to ${department.name}: ${payload.note}` : `Transferred to ${department.name}`,
            },
        });

        await recordAudit(tx, {
            actorId: user.id,
            action: AuditAction.COMPLAINT_TRANSFERRED,
            entityType: AuditEntity.COMPLAINT,
            entityId: id,
            metadata: {
                fromDepartmentId: complaint.departmentId,
                toDepartmentId: department.id,
                previousStaffId: complaint.assignedStaffId,
            },
            ipAddress: context.ipAddress,
        });

        return getComplaintDetail(tx, id);
    });
};

const submitFeedback = async (user: IAuthUser, id: string, payload: TFeedbackPayload, context: IRequestContext) => {
    return prisma.$transaction(async (tx) => {
        const complaint = await lockComplaint(tx, id);

        if (complaint.citizenId !== user.id) {
            throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only give feedback on your own complaints");
        }

        if (!FEEDBACK_STATUSES.includes(complaint.status)) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Feedback is not allowed yet",
                `Feedback can be given after the complaint is resolved. This one is ${complaint.status}.`
            );
        }

        const existing = await tx.feedback.findUnique({ where: { complaintId: id }, select: { id: true } });

        if (existing) {
            throw new AppError(StatusCodes.CONFLICT, "Feedback already submitted", "You already gave feedback on this complaint");
        }

        await tx.feedback.create({
            data: { complaintId: id, citizenId: user.id, rating: payload.rating, comment: payload.comment ?? null },
        });

        if (complaint.status === ComplaintStatus.RESOLVED) {
            await tx.complaint.update({ where: { id }, data: { status: ComplaintStatus.CLOSED, closedAt: new Date() } });

            await tx.complaintUpdate.create({
                data: {
                    complaintId: id,
                    actorId: user.id,
                    fromStatus: ComplaintStatus.RESOLVED,
                    toStatus: ComplaintStatus.CLOSED,
                    note: `Closed by the citizen with a ${payload.rating} star rating`,
                },
            });
        }

        await recordAudit(tx, {
            actorId: user.id,
            action: AuditAction.FEEDBACK_SUBMITTED,
            entityType: AuditEntity.COMPLAINT,
            entityId: id,
            metadata: { rating: payload.rating },
            ipAddress: context.ipAddress,
        });

        return getComplaintDetail(tx, id);
    });
};

export const ComplaintWorkflow = {
    changeStatus,
    cancelComplaint,
    reopenComplaint,
    transferComplaint,
    submitFeedback,
};
