import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { CategoryType, ComplaintStatus, type Prisma, Role } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { OPEN_STATUSES } from "../complaint/complaint.constant";
import type { TCategoryQuery, TCreateCategoryPayload, TUpdateCategoryPayload } from "./category.validation";

const categorySelect = {
    id: true,
    name: true,
    description: true,
    type: true,
    fee: true,
    slaHours: true,
    isActive: true,
    department: { select: { id: true, name: true } },
    createdAt: true,
    updatedAt: true,
} as const;

const ensureNameIsFree = async (name: string, ignoreId?: string) => {
    const existing = await prisma.category.findFirst({
        where: { name: { equals: name, mode: "insensitive" }, ...(ignoreId ? { id: { not: ignoreId } } : {}) },
        select: { id: true, deletedAt: true },
    });

    if (existing) {
        throw new AppError(StatusCodes.CONFLICT, "Category already exists", [
            {
                field: "name",
                message: existing.deletedAt ? "A removed category already used this name" : "A category with this name already exists",
            },
        ]);
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

const findCategoryOrThrow = async (id: string) => {
    const category = await prisma.category.findFirst({ where: { id, deletedAt: null } });

    if (!category) {
        throw new AppError(StatusCodes.NOT_FOUND, "Category not found", "No category found with this id");
    }

    return category;
};

const getAllCategories = async (query: TCategoryQuery, viewer?: IAuthUser) => {
    const canSeeInactive = query.includeInactive === "true" && viewer?.role === Role.ADMIN;

    const where: Prisma.CategoryWhereInput = {
        deletedAt: null,
        department: { deletedAt: null },
        ...(canSeeInactive ? {} : { isActive: true }),
        ...(query.type ? { type: query.type } : {}),
        ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        ...(query.searchTerm
            ? {
                  OR: [
                      { name: { contains: query.searchTerm, mode: "insensitive" } },
                      { description: { contains: query.searchTerm, mode: "insensitive" } },
                  ],
              }
            : {}),
    };

    return prisma.category.findMany({ where, select: categorySelect, orderBy: [{ type: "asc" }, { name: "asc" }] });
};

const getCategoryById = async (id: string) => {
    const category = await prisma.category.findFirst({ where: { id, deletedAt: null }, select: categorySelect });

    if (!category) {
        throw new AppError(StatusCodes.NOT_FOUND, "Category not found", "No category found with this id");
    }

    return category;
};

const createCategory = async (actorId: string, payload: TCreateCategoryPayload, context: IRequestContext) => {
    await ensureNameIsFree(payload.name);
    await ensureDepartmentExists(payload.departmentId);

    return prisma.$transaction(async (tx) => {
        const category = await tx.category.create({ data: payload, select: categorySelect });

        await recordAudit(tx, {
            actorId,
            action: AuditAction.CATEGORY_CREATED,
            entityType: AuditEntity.CATEGORY,
            entityId: category.id,
            metadata: { name: category.name, type: category.type, fee: Number(category.fee) },
            ipAddress: context.ipAddress,
        });

        return category;
    });
};

const updateCategory = async (actorId: string, id: string, payload: TUpdateCategoryPayload, context: IRequestContext) => {
    const current = await findCategoryOrThrow(id);

    if (payload.name && payload.name.toLowerCase() !== current.name.toLowerCase()) {
        await ensureNameIsFree(payload.name, id);
    }

    if (payload.departmentId && payload.departmentId !== current.departmentId) {
        await ensureDepartmentExists(payload.departmentId);
    }

    const nextType = payload.type ?? current.type;
    const nextFee = payload.fee ?? Number(current.fee);

    if (nextType === CategoryType.COMPLAINT && nextFee > 0) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Validation failed", [
            { field: "fee", message: "A complaint category cannot have a fee" },
        ]);
    }

    return prisma.$transaction(async (tx) => {
        const category = await tx.category.update({ where: { id }, data: payload, select: categorySelect });

        await recordAudit(tx, {
            actorId,
            action: AuditAction.CATEGORY_UPDATED,
            entityType: AuditEntity.CATEGORY,
            entityId: id,
            metadata: { changes: payload },
            ipAddress: context.ipAddress,
        });

        return category;
    });
};

const deleteCategory = async (actorId: string, id: string, context: IRequestContext) => {
    const category = await findCategoryOrThrow(id);

    const openComplaints = await prisma.complaint.count({
        where: { categoryId: id, deletedAt: null, status: { in: [ComplaintStatus.PENDING_PAYMENT, ...OPEN_STATUSES] } },
    });

    if (openComplaints > 0) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Category is in use",
            `${openComplaints} open complaints use this category. Set it inactive instead, or close them first.`
        );
    }

    await prisma.$transaction(async (tx) => {
        await tx.category.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });

        await recordAudit(tx, {
            actorId,
            action: AuditAction.CATEGORY_DELETED,
            entityType: AuditEntity.CATEGORY,
            entityId: id,
            metadata: { name: category.name },
            ipAddress: context.ipAddress,
        });
    });
};

export const CategoryService = {
    getAllCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
};
