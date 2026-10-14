import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ComplaintStatus, Role } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { recordAudit } from "../../utils/auditLog";
import { CATALOG_CACHE_SECONDS, cacheKeys, invalidateCatalogCache, remember } from "../../utils/cache";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { OPEN_STATUSES } from "../complaint/complaint.constant";
import type { TCreateDepartmentPayload, TUpdateDepartmentPayload } from "./department.validation";

const departmentSelect = {
    id: true,
    name: true,
    description: true,
    contactEmail: true,
    createdAt: true,
    updatedAt: true,
} as const;

const ensureNameIsFree = async (name: string, ignoreId?: string) => {
    const existing = await prisma.department.findFirst({
        where: { name: { equals: name, mode: "insensitive" }, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
        select: { id: true, deletedAt: true },
    });

    if (existing) {
        throw new AppError(StatusCodes.CONFLICT, "Department already exists", [
            {
                field: "name",
                message: existing.deletedAt ? "A removed department already used this name" : "A department with this name already exists",
            },
        ]);
    }
};

const findDepartmentOrThrow = async (id: string) => {
    const department = await prisma.department.findFirst({ where: { id, deletedAt: null }, select: departmentSelect });

    if (!department) {
        throw new AppError(StatusCodes.NOT_FOUND, "Department not found", "No department found with this id");
    }

    return department;
};

const getAllDepartments = async () => {
    return remember(cacheKeys.departments, CATALOG_CACHE_SECONDS, () => {
        return prisma.department.findMany({
            where: { deletedAt: null },
            select: {
                ...departmentSelect,
                _count: { select: { categories: { where: { deletedAt: null, isActive: true } } } },
            },
            orderBy: { name: "asc" },
        });
    });
};

const getDepartmentById = async (id: string) => {
    const department = await prisma.department.findFirst({
        where: { id, deletedAt: null },
        select: {
            ...departmentSelect,
            categories: {
                where: { deletedAt: null, isActive: true },
                select: { id: true, name: true, type: true, fee: true, slaHours: true },
                orderBy: { name: "asc" },
            },
        },
    });

    if (!department) {
        throw new AppError(StatusCodes.NOT_FOUND, "Department not found", "No department found with this id");
    }

    return department;
};

const createDepartment = async (actorId: string, payload: TCreateDepartmentPayload, context: IRequestContext) => {
    await ensureNameIsFree(payload.name);

    const created = await prisma.$transaction(async (tx) => {
        const department = await tx.department.create({ data: payload, select: departmentSelect });

        await recordAudit(tx, {
            actorId,
            action: AuditAction.DEPARTMENT_CREATED,
            entityType: AuditEntity.DEPARTMENT,
            entityId: department.id,
            metadata: { name: department.name },
            ipAddress: context.ipAddress,
        });

        return department;
    });

    await invalidateCatalogCache();

    return created;
};

const updateDepartment = async (actorId: string, id: string, payload: TUpdateDepartmentPayload, context: IRequestContext) => {
    const current = await findDepartmentOrThrow(id);

    if (payload.name && payload.name.toLowerCase() !== current.name.toLowerCase()) {
        await ensureNameIsFree(payload.name, id);
    }

    const updated = await prisma.$transaction(async (tx) => {
        const department = await tx.department.update({ where: { id }, data: payload, select: departmentSelect });

        await recordAudit(tx, {
            actorId,
            action: AuditAction.DEPARTMENT_UPDATED,
            entityType: AuditEntity.DEPARTMENT,
            entityId: id,
            metadata: { changes: payload },
            ipAddress: context.ipAddress,
        });

        return department;
    });

    await invalidateCatalogCache();

    return updated;
};

const deleteDepartment = async (actorId: string, id: string, context: IRequestContext) => {
    const department = await findDepartmentOrThrow(id);

    const [activeCategories, staffMembers, openComplaints] = await Promise.all([
        prisma.category.count({ where: { departmentId: id, deletedAt: null } }),
        prisma.user.count({ where: { departmentId: id, role: Role.STAFF, deletedAt: null } }),
        prisma.complaint.count({
            where: { departmentId: id, deletedAt: null, status: { in: [ComplaintStatus.PENDING_PAYMENT, ...OPEN_STATUSES] } },
        }),
    ]);

    if (activeCategories > 0 || staffMembers > 0 || openComplaints > 0) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Department is in use",
            `Move or remove its ${activeCategories} categories, ${staffMembers} staff members and ${openComplaints} open complaints first`
        );
    }

    await prisma.$transaction(async (tx) => {
        await tx.department.update({ where: { id }, data: { deletedAt: new Date() } });

        await recordAudit(tx, {
            actorId,
            action: AuditAction.DEPARTMENT_DELETED,
            entityType: AuditEntity.DEPARTMENT,
            entityId: id,
            metadata: { name: department.name },
            ipAddress: context.ipAddress,
        });
    });

    await invalidateCatalogCache();
};

export const DepartmentService = {
    getAllDepartments,
    getDepartmentById,
    createDepartment,
    updateDepartment,
    deleteDepartment,
};
