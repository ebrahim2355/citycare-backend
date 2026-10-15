import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { Role } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { safeUserSelect } from "./user.constant";
import type { TUpdateProfilePayload } from "./user.validation";

const getMe = async (userId: string) => {
    return prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: safeUserSelect,
    });
};

const updateProfile = async (user: IAuthUser, payload: TUpdateProfilePayload, context: IRequestContext) => {
    if (payload.acceptsAssignments !== undefined && user.role !== Role.STAFF) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Validation failed", [
            { field: "acceptsAssignments", message: "Only staff members can change their availability" },
        ]);
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.user.update({
            where: { id: user.id },
            data: payload,
            select: safeUserSelect,
        });

        if (payload.acceptsAssignments !== undefined) {
            await recordAudit(tx, {
                actorId: user.id,
                action: AuditAction.STAFF_AVAILABILITY_CHANGED,
                entityType: AuditEntity.USER,
                entityId: user.id,
                metadata: { acceptsAssignments: payload.acceptsAssignments },
                ipAddress: context.ipAddress,
            });
        }

        return updated;
    });
};

export const UserService = {
    getMe,
    updateProfile,
};
