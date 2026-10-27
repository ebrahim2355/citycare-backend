import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { CategoryType, ComplaintPaymentStatus, ComplaintStatus, NotificationType, Prisma, Role } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import { roundCoordinate } from "../../utils/geo";
import { getMeta, getPagination } from "../../utils/pagination";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { complaintLabel, Inbox } from "../notification/notification.inbox";
import { PaymentSettlement } from "../payment/payment.settlement";
import {
    CITIZEN_DELETABLE_STATUSES,
    CITIZEN_EDITABLE_STATUSES,
    complaintDetailSelect,
    complaintListSelect,
    OPEN_STATUSES,
} from "./complaint.constant";
import { addHours, generateTrackingCode, getComplaintDetail, withOverdue } from "./complaint.utils";
import type { TComplaintQuery, TCreateComplaintPayload, TUpdateComplaintPayload } from "./complaint.validation";

const MAX_CODE_ATTEMPTS = 3;

const isUniqueViolation = (error: unknown) => {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
};

const ensureCanView = (user: IAuthUser, complaint: { citizen: { id: string }; assignedStaff: { id: string } | null }) => {
    if (user.role === Role.ADMIN) {
        return;
    }

    if (user.role === Role.CITIZEN && complaint.citizen.id !== user.id) {
        throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only open your own complaints");
    }

    if (user.role === Role.STAFF && complaint.assignedStaff?.id !== user.id) {
        throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only open complaints that are assigned to you");
    }
};

const createComplaint = async (user: IAuthUser, payload: TCreateComplaintPayload, context: IRequestContext) => {
    const category = await prisma.category.findFirst({
        where: { id: payload.categoryId, deletedAt: null, isActive: true, department: { deletedAt: null } },
        select: { id: true, type: true, fee: true, slaHours: true, departmentId: true },
    });

    if (!category) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Category not found", [
            { field: "categoryId", message: "No active category found with this id" },
        ]);
    }

    const requiresPayment = category.type === CategoryType.SERVICE && category.fee.greaterThan(0);
    const now = new Date();

    for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS; attempt++) {
        try {
            const complaint = await prisma.$transaction(async (tx) => {
                const created = await tx.complaint.create({
                    data: {
                        trackingCode: generateTrackingCode(now),
                        title: payload.title,
                        description: payload.description,
                        address: payload.address,
                        area: payload.area,
                        priority: payload.priority,
                        latitude: payload.latitude ?? null,
                        longitude: payload.longitude ?? null,
                        isPublic: category.type === CategoryType.COMPLAINT && (payload.isPublic ?? true),
                        type: category.type,
                        fee: category.fee,
                        status: requiresPayment ? ComplaintStatus.PENDING_PAYMENT : ComplaintStatus.SUBMITTED,
                        paymentStatus: requiresPayment ? ComplaintPaymentStatus.UNPAID : ComplaintPaymentStatus.NOT_REQUIRED,
                        submittedAt: requiresPayment ? null : now,
                        dueAt: requiresPayment ? null : addHours(now, category.slaHours),
                        citizenId: user.id,
                        categoryId: category.id,
                        departmentId: category.departmentId,
                        updates: {
                            create: {
                                actorId: user.id,
                                toStatus: requiresPayment ? ComplaintStatus.PENDING_PAYMENT : ComplaintStatus.SUBMITTED,
                                note: requiresPayment ? "Request created. Waiting for the service fee payment." : "Complaint submitted",
                            },
                        },
                    },
                    select: complaintDetailSelect,
                });

                await recordAudit(tx, {
                    actorId: user.id,
                    action: AuditAction.COMPLAINT_CREATED,
                    entityType: AuditEntity.COMPLAINT,
                    entityId: created.id,
                    metadata: { trackingCode: created.trackingCode, categoryId: category.id, status: created.status },
                    ipAddress: context.ipAddress,
                });

                if (!requiresPayment) {
                    await Inbox.notifyAdmins(tx, {
                        type: NotificationType.COMPLAINT_SUBMITTED,
                        title: "New complaint",
                        body: `${complaintLabel(created)} in ${created.area}, for ${created.department.name}.`,
                        complaintId: created.id,
                    });
                }

                return created;
            });

            return withOverdue(complaint);
        } catch (error) {
            if (!isUniqueViolation(error) || attempt === MAX_CODE_ATTEMPTS) {
                throw error;
            }
        }
    }

    throw new AppError(StatusCodes.INTERNAL_SERVER_ERROR, "Could not create the complaint", "Please try again");
};

const buildComplaintFilters = (user: IAuthUser, query: TComplaintQuery): Prisma.ComplaintWhereInput => {
    const where: Prisma.ComplaintWhereInput = { deletedAt: null };
    const conditions: Prisma.ComplaintWhereInput[] = [];

    if (user.role === Role.CITIZEN) {
        where.citizenId = user.id;
    } else if (user.role === Role.STAFF) {
        where.assignedStaffId = user.id;
    } else {
        if (query.citizenId) {
            where.citizenId = query.citizenId;
        }

        if (query.assignedStaffId) {
            where.assignedStaffId = query.assignedStaffId;
        }

        if (query.unassigned === "true") {
            where.assignedStaffId = null;
        }
    }

    if (query.status) {
        where.status = query.status;
    }

    if (query.priority) {
        where.priority = query.priority;
    }

    if (query.type) {
        where.type = query.type;
    }

    if (query.paymentStatus) {
        where.paymentStatus = query.paymentStatus;
    }

    if (query.categoryId) {
        where.categoryId = query.categoryId;
    }

    if (query.departmentId) {
        where.departmentId = query.departmentId;
    }

    if (query.area) {
        where.area = { contains: query.area, mode: "insensitive" };
    }

    if (query.from || query.to) {
        where.createdAt = {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
        };
    }

    if (query.overdue) {
        const overdueFilter: Prisma.ComplaintWhereInput = { dueAt: { lt: new Date() }, status: { in: OPEN_STATUSES } };

        conditions.push(query.overdue === "true" ? overdueFilter : { NOT: overdueFilter });
    }

    if (query.escalated) {
        where.escalatedAt = query.escalated === "true" ? { not: null } : null;
    }

    if (query.searchTerm) {
        conditions.push({
            OR: [
                { title: { contains: query.searchTerm, mode: "insensitive" } },
                { description: { contains: query.searchTerm, mode: "insensitive" } },
                { trackingCode: { contains: query.searchTerm, mode: "insensitive" } },
                { address: { contains: query.searchTerm, mode: "insensitive" } },
            ],
        });
    }

    if (conditions.length) {
        where.AND = conditions;
    }

    return where;
};

const getComplaints = async (user: IAuthUser, query: TComplaintQuery) => {
    const { page, limit, skip, sortOrder } = getPagination(query);
    const where = buildComplaintFilters(user, query);
    const sortBy = query.sortBy ?? "createdAt";

    const firstOrder: Prisma.ComplaintOrderByWithRelationInput =
        sortBy === "dueAt"
            ? { dueAt: { sort: sortOrder, nulls: "last" } }
            : sortBy === "supportCount"
              ? { supports: { _count: sortOrder } }
              : { [sortBy]: sortOrder };
    const orderBy: Prisma.ComplaintOrderByWithRelationInput[] = [firstOrder, { id: "asc" }];

    const [complaints, total] = await prisma.$transaction([
        prisma.complaint.findMany({ where, select: complaintListSelect, orderBy, skip, take: limit }),
        prisma.complaint.count({ where }),
    ]);

    return {
        meta: getMeta(page, limit, total),
        data: complaints.map(withOverdue),
    };
};

const getComplaintById = async (user: IAuthUser, id: string) => {
    const complaint = await prisma.complaint.findFirst({
        where: { id, deletedAt: null },
        select: complaintDetailSelect,
    });

    if (!complaint) {
        throw new AppError(StatusCodes.NOT_FOUND, "Complaint not found", "No complaint found with this id");
    }

    ensureCanView(user, complaint);

    return withOverdue(complaint);
};

const trackComplaint = async (trackingCode: string, viewer?: IAuthUser) => {
    const complaint = await prisma.complaint.findFirst({
        where: { trackingCode: trackingCode.toUpperCase(), deletedAt: null },
        select: {
            id: true,
            citizenId: true,
            trackingCode: true,
            title: true,
            type: true,
            priority: true,
            status: true,
            area: true,
            isPublic: true,
            latitude: true,
            longitude: true,
            _count: { select: { supports: true } },
            submittedAt: true,
            dueAt: true,
            resolvedAt: true,
            closedAt: true,
            createdAt: true,
            category: { select: { name: true } },
            department: { select: { name: true } },
            updates: {
                select: { fromStatus: true, toStatus: true, createdAt: true },
                orderBy: { createdAt: "asc" },
            },
        },
    });

    if (!complaint) {
        throw new AppError(StatusCodes.NOT_FOUND, "Complaint not found", "No complaint found with this tracking code");
    }

    const { citizenId, ...tracked } = complaint;
    const visible = complaint.isPublic && complaint.latitude !== null && complaint.longitude !== null;
    const support =
        viewer && complaint.isPublic
            ? await prisma.complaintSupport.findUnique({
                  where: { complaintId_userId: { complaintId: complaint.id, userId: viewer.id } },
                  select: { userId: true },
              })
            : null;

    return withOverdue({
        ...tracked,
        id: complaint.isPublic ? complaint.id : null,
        latitude: visible && complaint.latitude !== null ? roundCoordinate(complaint.latitude) : null,
        longitude: visible && complaint.longitude !== null ? roundCoordinate(complaint.longitude) : null,
        isMine: viewer?.id === citizenId,
        supportedByMe: Boolean(support),
    });
};

const updateComplaint = async (user: IAuthUser, id: string, payload: TUpdateComplaintPayload, context: IRequestContext) => {
    const complaint = await prisma.complaint.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, citizenId: true, status: true, priority: true, type: true },
    });

    if (!complaint) {
        throw new AppError(StatusCodes.NOT_FOUND, "Complaint not found", "No complaint found with this id");
    }

    if (user.role === Role.CITIZEN) {
        if (complaint.citizenId !== user.id) {
            throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only edit your own complaints");
        }

        if (payload.isPublic && complaint.type === CategoryType.SERVICE) {
            throw new AppError(StatusCodes.BAD_REQUEST, "Validation failed", [
                { field: "isPublic", message: "A home service request is always private" },
            ]);
        }

        const onlyVisibility = Object.keys(payload).every((field) => field === "isPublic");

        if (!onlyVisibility && !CITIZEN_EDITABLE_STATUSES.includes(complaint.status)) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Complaint can no longer be edited",
                "A complaint can be edited only before it is assigned to a staff member"
            );
        }
    } else {
        const otherFields = Object.keys(payload).filter((field) => field !== "priority");

        if (otherFields.length) {
            throw new AppError(
                StatusCodes.BAD_REQUEST,
                "Validation failed",
                otherFields.map((field) => ({ field, message: "An admin can only change the priority" }))
            );
        }

        if (![ComplaintStatus.PENDING_PAYMENT, ...OPEN_STATUSES].includes(complaint.status)) {
            throw new AppError(StatusCodes.CONFLICT, "Complaint can no longer be edited", "This complaint is already finished");
        }
    }

    const priorityChanged = payload.priority !== undefined && payload.priority !== complaint.priority;

    return prisma.$transaction(async (tx) => {
        await tx.complaint.update({ where: { id }, data: payload });

        if (priorityChanged) {
            await tx.complaintUpdate.create({
                data: {
                    complaintId: id,
                    actorId: user.id,
                    fromStatus: complaint.status,
                    toStatus: complaint.status,
                    note: `Priority changed from ${complaint.priority} to ${payload.priority}`,
                },
            });
        }

        await recordAudit(tx, {
            actorId: user.id,
            action: AuditAction.COMPLAINT_UPDATED,
            entityType: AuditEntity.COMPLAINT,
            entityId: id,
            metadata: { changes: payload },
            ipAddress: context.ipAddress,
        });

        return getComplaintDetail(tx, id);
    });
};

const deleteComplaint = async (user: IAuthUser, id: string, context: IRequestContext) => {
    const complaint = await prisma.complaint.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, citizenId: true, status: true, paymentStatus: true, trackingCode: true },
    });

    if (!complaint) {
        throw new AppError(StatusCodes.NOT_FOUND, "Complaint not found", "No complaint found with this id");
    }

    if (user.role === Role.CITIZEN) {
        if (complaint.citizenId !== user.id) {
            throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only remove your own complaints");
        }

        if (!CITIZEN_DELETABLE_STATUSES.includes(complaint.status)) {
            throw new AppError(
                StatusCodes.CONFLICT,
                "Complaint cannot be removed now",
                "Only cancelled, rejected or closed complaints can be removed. Cancel it first."
            );
        }
    }

    if (complaint.paymentStatus === ComplaintPaymentStatus.PAID && OPEN_STATUSES.includes(complaint.status)) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Complaint cannot be removed now",
            "This request has a paid service fee. Reject it first so the fee is refunded."
        );
    }

    await prisma.$transaction(async (tx) => {
        const removed = await tx.complaint.updateMany({ where: { id, deletedAt: null }, data: { deletedAt: new Date() } });

        if (removed.count === 0) {
            throw new AppError(StatusCodes.NOT_FOUND, "Complaint not found", "No complaint found with this id");
        }

        await recordAudit(tx, {
            actorId: user.id,
            action: AuditAction.COMPLAINT_DELETED,
            entityType: AuditEntity.COMPLAINT,
            entityId: id,
            metadata: { trackingCode: complaint.trackingCode, status: complaint.status },
            ipAddress: context.ipAddress,
        });
    });

    await PaymentSettlement.cancelPendingPayments(id);
};

export const ComplaintService = {
    ensureCanView,
    buildComplaintFilters,
    createComplaint,
    getComplaints,
    getComplaintById,
    trackComplaint,
    updateComplaint,
    deleteComplaint,
};
