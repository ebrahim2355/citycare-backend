import { StatusCodes } from "http-status-codes";
import config from "../../config";
import AppError from "../../errors/AppError";
import { ComplaintStatus, NotificationType, type Prisma, Role, UserStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { complaintLabel, Inbox } from "../notification/notification.inbox";
import { ACTIVE_ASSIGNMENT_STATUSES, OPEN_STATUSES } from "./complaint.constant";
import { getComplaintDetail, lockComplaint } from "./complaint.utils";
import type { TAssignComplaintPayload } from "./complaint.validation";

interface ILockedStaff {
    id: string;
    name: string;
    role: Role;
    status: UserStatus;
    departmentId: string | null;
    acceptsAssignments: boolean;
    deletedAt: Date | null;
    createdAt: Date;
}

interface ICandidate {
    staff: ILockedStaff;
    activeAssignments: number;
}

const lockStaff = async (tx: Prisma.TransactionClient, staffId: string) => {
    const rows = await tx.$queryRaw<ILockedStaff[]>`
        SELECT "id", "name", "role", "status", "departmentId", "acceptsAssignments", "deletedAt", "createdAt"
        FROM "users"
        WHERE "id" = ${staffId}
        FOR UPDATE
    `;

    return rows[0] ?? null;
};

const lockDepartmentStaff = (tx: Prisma.TransactionClient, departmentId: string) => {
    return tx.$queryRaw<ILockedStaff[]>`
        SELECT "id", "name", "role", "status", "departmentId", "acceptsAssignments", "deletedAt", "createdAt"
        FROM "users"
        WHERE "departmentId" = ${departmentId} AND "role" = 'STAFF' AND "deletedAt" IS NULL
        ORDER BY "id"
        FOR UPDATE
    `;
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

    if (!staff.acceptsAssignments) {
        return "This staff member is not taking new complaints right now";
    }

    return null;
};

const checkChosenStaff = async (
    tx: Prisma.TransactionClient,
    staffId: string,
    departmentId: string,
    complaintId: string
): Promise<ICandidate> => {
    const maxActive = config.complaint.maxActiveAssignments;
    const staff = await lockStaff(tx, staffId);
    const problem = getStaffProblem(staff, departmentId);

    if (problem || !staff) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Staff member cannot take this complaint", [
            { field: "staffId", message: problem ?? "No staff member found with this id" },
        ]);
    }

    const activeAssignments = await countActiveAssignments(tx, staff.id, complaintId);

    if (activeAssignments >= maxActive) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Staff member is at full capacity",
            `${staff.name} already has ${activeAssignments} active complaints. The limit is ${maxActive}.`
        );
    }

    return { staff, activeAssignments };
};

const pickLeastBusyStaff = async (
    tx: Prisma.TransactionClient,
    departmentId: string,
    currentStaffId: string | null,
    complaintId: string
): Promise<ICandidate> => {
    const available = (await lockDepartmentStaff(tx, departmentId)).filter(
        (staff) => staff.id !== currentStaffId && !getStaffProblem(staff, departmentId)
    );
    const workload = await tx.complaint.groupBy({
        by: ["assignedStaffId"],
        where: {
            assignedStaffId: { in: available.map((staff) => staff.id) },
            status: { in: ACTIVE_ASSIGNMENT_STATUSES },
            deletedAt: null,
            id: { not: complaintId },
        },
        _count: { _all: true },
    });
    const activeByStaff = new Map(workload.map((row) => [row.assignedStaffId, row._count._all]));
    const choice = available
        .map((staff) => ({ staff, activeAssignments: activeByStaff.get(staff.id) ?? 0 }))
        .filter((candidate) => candidate.activeAssignments < config.complaint.maxActiveAssignments)
        .sort(
            (a, b) =>
                a.activeAssignments - b.activeAssignments || new Date(a.staff.createdAt).getTime() - new Date(b.staff.createdAt).getTime()
        )[0];

    if (!choice) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "No staff member is available",
            "Every staff member of this department is at full capacity or the department has no active staff"
        );
    }

    return choice;
};

const assignComplaint = async (admin: IAuthUser, id: string, payload: TAssignComplaintPayload, context: IRequestContext) => {
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
            const choice = payload.staffId
                ? await checkChosenStaff(tx, payload.staffId, complaint.departmentId, id)
                : await pickLeastBusyStaff(tx, complaint.departmentId, complaint.assignedStaffId, id);

            const { staff, activeAssignments } = choice;

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

            const detail = await getComplaintDetail(tx, id);
            const label = complaintLabel(detail);

            await Inbox.notify(tx, [detail.citizen.id], {
                type: NotificationType.COMPLAINT_ASSIGNED,
                title: "A staff member has your report",
                body: `${label} is now with ${staff.name} from ${detail.department.name}.`,
                complaintId: id,
            });
            await Inbox.notify(
                tx,
                [staff.id],
                {
                    type: NotificationType.COMPLAINT_ASSIGNED,
                    title: "New job for you",
                    body: `${label} in ${detail.area}.`,
                    complaintId: id,
                },
                { skipUserId: admin.id }
            );

            if (complaint.assignedStaffId && complaint.assignedStaffId !== staff.id) {
                await Inbox.notify(tx, [complaint.assignedStaffId], {
                    type: NotificationType.COMPLAINT_UNASSIGNED,
                    title: "Job moved to a colleague",
                    body: `${label} was given to ${staff.name}.`,
                    complaintId: id,
                });
            }

            return detail;
        },
        { timeout: 15000 }
    );
};

export const ComplaintAssignment = {
    assignComplaint,
};
