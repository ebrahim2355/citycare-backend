import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ComplaintStatus, type Prisma, Role } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { getComplaintDetail, lockComplaint } from "./complaint.utils";
import type { TChangeStatusPayload } from "./complaint.validation";

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

const changeStatus = async (user: IAuthUser, id: string, payload: TChangeStatusPayload, context: IRequestContext) => {
    return prisma.$transaction(async (tx) => {
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
};

export const ComplaintWorkflow = {
    changeStatus,
};
