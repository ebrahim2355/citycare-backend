import { StatusCodes } from "http-status-codes";
import config from "../../config";
import AppError from "../../errors/AppError";
import { ComplaintStatus, type Prisma, Role, UserStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import { getMeta, getPagination } from "../../utils/pagination";
import { hashPassword } from "../../utils/password";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { ACTIVE_ASSIGNMENT_STATUSES, OPEN_STATUSES } from "../complaint/complaint.constant";
import { safeUserSelect } from "../user/user.constant";
import type { TCreateUserPayload, TStaffQuery, TUpdateRolePayload, TUpdateStatusPayload, TUserQuery } from "./admin.validation";

const findUserOrThrow = async (id: string) => {
    const user = await prisma.user.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, name: true, email: true, role: true, status: true, departmentId: true },
    });

    if (!user) {
        throw new AppError(StatusCodes.NOT_FOUND, "User not found", "No user found with this id");
    }

    return user;
};

const ensureNotSelf = (admin: IAuthUser, userId: string, action: string) => {
    if (admin.id === userId) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Action is not allowed", `You cannot ${action} your own account`);
    }
};

const ensureDepartmentExists = async (departmentId: string) => {
    const department = await prisma.department.findFirst({ where: { id: departmentId, deletedAt: null }, select: { id: true } });

    if (!department) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Department not found", [
            { field: "departmentId", message: "No department found with this id" },
        ]);
    }
};

const ensureNoActiveAssignments = async (userId: string, action: string) => {
    const activeAssignments = await prisma.complaint.count({
        where: { assignedStaffId: userId, status: { in: ACTIVE_ASSIGNMENT_STATUSES }, deletedAt: null },
    });

    if (activeAssignments > 0) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Staff member has active complaints",
            `Reassign the ${activeAssignments} active complaints of this staff member before you ${action}`
        );
    }
};

const getAllUsers = async (query: TUserQuery) => {
    const { page, limit, skip, sortOrder } = getPagination(query);

    const where: Prisma.UserWhereInput = {
        deletedAt: null,
        ...(query.role ? { role: query.role } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.searchTerm
            ? {
                  OR: [
                      { name: { contains: query.searchTerm, mode: "insensitive" } },
                      { email: { contains: query.searchTerm, mode: "insensitive" } },
                      { phone: { contains: query.searchTerm } },
                  ],
              }
            : {}),
    };

    const [users, total] = await prisma.$transaction([
        prisma.user.findMany({
            where,
            select: safeUserSelect,
            orderBy: [{ [query.sortBy ?? "createdAt"]: sortOrder }, { id: "asc" }],
            skip,
            take: limit,
        }),
        prisma.user.count({ where }),
    ]);

    return {
        meta: getMeta(page, limit, total),
        data: users,
    };
};

const createUser = async (admin: IAuthUser, payload: TCreateUserPayload, context: IRequestContext) => {
    const existingUser = await prisma.user.findUnique({ where: { email: payload.email }, select: { id: true } });

    if (existingUser) {
        throw new AppError(StatusCodes.CONFLICT, "User already exists", [{ field: "email", message: "This email is already registered" }]);
    }

    const departmentId = payload.role === Role.STAFF ? (payload.departmentId ?? null) : null;

    if (departmentId) {
        await ensureDepartmentExists(departmentId);
    }

    const password = await hashPassword(payload.password);

    return prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
            data: {
                name: payload.name,
                email: payload.email,
                password,
                role: payload.role,
                phone: payload.phone ?? null,
                departmentId,
            },
            select: safeUserSelect,
        });

        await recordAudit(tx, {
            actorId: admin.id,
            action: AuditAction.USER_CREATED,
            entityType: AuditEntity.USER,
            entityId: user.id,
            metadata: { email: user.email, role: user.role, departmentId },
            ipAddress: context.ipAddress,
        });

        return user;
    });
};

const updateUserRole = async (admin: IAuthUser, id: string, payload: TUpdateRolePayload, context: IRequestContext) => {
    ensureNotSelf(admin, id, "change the role of");

    const user = await findUserOrThrow(id);
    const departmentId = payload.role === Role.STAFF ? (payload.departmentId ?? null) : null;

    if (user.role === payload.role && user.departmentId === departmentId) {
        throw new AppError(StatusCodes.CONFLICT, "Nothing to change", "This user already has this role and department");
    }

    if (departmentId) {
        await ensureDepartmentExists(departmentId);
    }

    if (user.role === Role.STAFF) {
        await ensureNoActiveAssignments(id, "change the role or department");
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
            where: { id },
            data: { role: payload.role, departmentId },
            select: safeUserSelect,
        });

        await recordAudit(tx, {
            actorId: admin.id,
            action: AuditAction.USER_ROLE_CHANGED,
            entityType: AuditEntity.USER,
            entityId: id,
            metadata: {
                from: { role: user.role, departmentId: user.departmentId },
                to: { role: payload.role, departmentId },
            },
            ipAddress: context.ipAddress,
        });

        return updated;
    });
};

const updateUserStatus = async (admin: IAuthUser, id: string, payload: TUpdateStatusPayload, context: IRequestContext) => {
    ensureNotSelf(admin, id, "block or unblock");

    const user = await findUserOrThrow(id);

    if (user.status === payload.status) {
        throw new AppError(StatusCodes.CONFLICT, "Nothing to change", `This user is already ${payload.status}`);
    }

    if (payload.status === UserStatus.BLOCKED && user.role === Role.STAFF) {
        await ensureNoActiveAssignments(id, "block this account");
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({ where: { id }, data: { status: payload.status }, select: safeUserSelect });

        if (payload.status === UserStatus.BLOCKED) {
            await tx.refreshToken.deleteMany({ where: { userId: id } });
        }

        await recordAudit(tx, {
            actorId: admin.id,
            action: AuditAction.USER_STATUS_CHANGED,
            entityType: AuditEntity.USER,
            entityId: id,
            metadata: { from: user.status, to: payload.status, reason: payload.reason ?? null },
            ipAddress: context.ipAddress,
        });

        return updated;
    });
};

const deleteUser = async (admin: IAuthUser, id: string, context: IRequestContext) => {
    ensureNotSelf(admin, id, "remove");

    const user = await findUserOrThrow(id);

    if (user.role === Role.STAFF) {
        await ensureNoActiveAssignments(id, "remove this account");
    }

    const openComplaints = await prisma.complaint.count({
        where: { citizenId: id, deletedAt: null, status: { in: [ComplaintStatus.PENDING_PAYMENT, ...OPEN_STATUSES] } },
    });

    if (openComplaints > 0) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "User has open complaints",
            `This user has ${openComplaints} open complaints. Close or reject them before you remove the account.`
        );
    }

    await prisma.$transaction(async (tx) => {
        await tx.user.update({ where: { id }, data: { deletedAt: new Date() } });
        await tx.refreshToken.deleteMany({ where: { userId: id } });

        await recordAudit(tx, {
            actorId: admin.id,
            action: AuditAction.USER_DELETED,
            entityType: AuditEntity.USER,
            entityId: id,
            metadata: { email: user.email, role: user.role },
            ipAddress: context.ipAddress,
        });
    });
};

const getStaffWorkload = async (query: TStaffQuery) => {
    const maxActive = config.complaint.maxActiveAssignments;

    const staffMembers = await prisma.user.findMany({
        where: {
            role: Role.STAFF,
            deletedAt: null,
            ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        },
        select: {
            id: true,
            name: true,
            email: true,
            status: true,
            department: { select: { id: true, name: true } },
            _count: {
                select: { assignedComplaints: { where: { status: { in: ACTIVE_ASSIGNMENT_STATUSES }, deletedAt: null } } },
            },
        },
        orderBy: { name: "asc" },
    });

    return staffMembers
        .map(({ _count, ...staff }) => ({
            ...staff,
            activeAssignments: _count.assignedComplaints,
            capacity: maxActive,
            isAvailable: staff.status === UserStatus.ACTIVE && _count.assignedComplaints < maxActive,
        }))
        .sort((a, b) => a.activeAssignments - b.activeAssignments);
};

export const AdminService = {
    getAllUsers,
    createUser,
    updateUserRole,
    updateUserStatus,
    deleteUser,
    getStaffWorkload,
};
