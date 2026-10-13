import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { CategoryType, ComplaintPaymentStatus, ComplaintStatus, Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { complaintDetailSelect } from "./complaint.constant";
import { addHours, generateTrackingCode, withOverdue } from "./complaint.utils";
import type { TCreateComplaintPayload } from "./complaint.validation";

const MAX_CODE_ATTEMPTS = 3;

const isUniqueViolation = (error: unknown) => {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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

export const ComplaintService = {
    createComplaint,
};
