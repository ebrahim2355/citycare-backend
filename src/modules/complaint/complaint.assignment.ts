import { StatusCodes } from "http-status-codes";
import config from "../../config";
import AppError from "../../errors/AppError";
import { ComplaintStatus, type Prisma, Role, UserStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { ACTIVE_ASSIGNMENT_STATUSES, OPEN_STATUSES } from "./complaint.constant";
import { getComplaintDetail, lockComplaint } from "./complaint.utils";
import type { TAssignComplaintPayload } from "./complaint.validation";

interface ILockedStaff {
    id: string;
    name: string;
    role: Role;
    status: UserStatus;
    departmentId: string | null;
    deletedAt: Date | null;
}

const lockStaff = async (tx: Prisma.TransactionClient, staffId: string) => {
    const rows = await tx.$queryRaw<ILockedStaff[]>`
        SELECT "id", "name", "role", "status", "departmentId", "deletedAt"
        FROM "users"
        WHERE "id" = ${staffId}
        FOR UPDATE
    `;

    return rows[0] ?? null;
};

const countActiveAssignments = (tx: Prisma.TransactionClient, staffId: string, ignoreComplaintId: string) => {
    return tx.complaint.count({
        where: {
            assignedStaffId: staffId,
            status: { in: ACTIVE_ASSIGNMENT_STATUSES },
            deletedAt: null,
            id: { not: ignoreComplaintId },
        },
    });
};

const getCandidatesByWorkload = async (tx: Prisma.TransactionClient, departmentId: string, currentStaffId: string | null) => {
    const staffMembers = await tx.user.findMany({
        where: {
            role: Role.STAFF,
            status: UserStatus.ACTIVE,
            deletedAt: null,
            departmentId,
            ...(currentStaffId ? { id: { not: currentStaffId } } : {}),
        },
        select: {
            id: true,
            createdAt: true,
            _count: {
                select: { assignedComplaints: { where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES }, deletedAt: null } } },
            },
        },
    });

    return staffMembers
        .sort((a, b) => a._count.assignedComplaints - b._count.assignedComplaints || a.createdAt.getTime() - b.createdAt.getTime())
        .map((staff) => staff.id);
};

const getStaffProblem = (staff: ILockedStaff | null, departmentId: string) => {
    if (!staff || staff.deletedAt || staff.role !== Role.STAFF) {
        return "No staff member found with this id";
    }

    if (staff.status !== UserStatus.ACTIVE) {
        return "This staff member is blocked";
    }

    if (staff.departmentId !== departmentId) {
        return "This staff member works in another department";
    }

    return null;
};

const assignComplaint = async (admin: IAuthUser, id: string, payload: TAssignComplaintPayload, context: IRequestContext) => {
    const maxActive = config.complaint.maxActiveAssignments;

    return prisma.$transaction(
        async (tx) => {
            const complaint = await lockComplaint(tx, id);

            if (!OPEN_STATUSES.includes(complaint.status)) {
                throw new AppError(
                    StatusCodes.CONFLICT,
                    "Complaint cannot be assigned",
                    `Only submitted, assigned or in progress complaints can be assigned. This one is ${complaint.status}.`
                );
            }

            if (payload.staffId && payload.staffId === complaint.assignedStaffId) {
                throw new AppError(StatusCodes.CONFLICT, "Already assigned", "This complaint is already assigned to this staff member");
            }

            const isAutomatic = !payload.staffId;
            const candidateIds = payload.staffId
                ? [payload.staffId]
                : await getCandidatesByWorkload(tx, complaint.departmentId, complaint.assignedStaffId);

            for (const candidateId of candidateIds) {
                const staff = await lockStaff(tx, candidateId);
                const problem = getStaffProblem(staff, complaint.departmentId);

                if (problem || !staff) {
                    if (isAutomatic) {
                        continue;
                    }

                    throw new AppError(StatusCodes.BAD_REQUEST, "Staff member cannot take this complaint", [
                        { field: "staffId", message: problem ?? "No staff member found with this id" },
                    ]);
                }

                const activeAssignments = await countActiveAssignments(tx, staff.id, id);

                if (activeAssignments >= maxActive) {
                    if (isAutomatic) {
                        continue;
                    }

                    throw new AppError(
                        StatusCodes.CONFLICT,
                        "Staff member is at full capacity",
                        `${staff.name} already has ${activeAssignments} active complaints. The limit is ${maxActive}.`
                    );
                }

                await tx.complaint.update({
                    where: { id },
                    data: { assignedStaffId: staff.id, status: ComplaintStatus.ASSIGNED, assignedAt: new Date() },
                });

                await tx.complaintUpdate.create({
                    data: {
                        complaintId: id,
                        actorId: admin.id,
                        fromStatus: complaint.status,
                        toStatus: ComplaintStatus.ASSIGNED,
                        note: payload.note ?? `Assigned to ${staff.name}`,
                    },
                });

                await recordAudit(tx, {
                    actorId: admin.id,
                    action: AuditAction.COMPLAINT_ASSIGNED,
                    entityType: AuditEntity.COMPLAINT,
                    entityId: id,
                    metadata: {
                        staffId: staff.id,
                        previousStaffId: complaint.assignedStaffId,
                        automatic: isAutomatic,
                        activeAssignments: activeAssignments + 1,
                    },
                    ipAddress: context.ipAddress,
                });

                return getComplaintDetail(tx, id);
            }

            throw new AppError(
                StatusCodes.CONFLICT,
                "No staff member is available",
                "Every staff member of this department is at full capacity or the department has no active staff"
            );
        },
        { timeout: 15000 }
    );
};

export const ComplaintAssignment = {
    assignComplaint,
};
