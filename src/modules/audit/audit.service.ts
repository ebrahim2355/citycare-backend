import type { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import { getMeta, getPagination } from "../../utils/pagination";
import type { TAuditLogQuery } from "./audit.validation";

const getAuditLogs = async (query: TAuditLogQuery) => {
    const { page, limit, skip, sortOrder } = getPagination(query);

    const where: Prisma.AuditLogWhereInput = {
        ...(query.action ? { action: query.action } : {}),
        ...(query.entityType ? { entityType: query.entityType } : {}),
        ...(query.entityId ? { entityId: query.entityId } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.from || query.to
            ? {
                  createdAt: {
                      ...(query.from ? { gte: query.from } : {}),
                      ...(query.to ? { lte: query.to } : {}),
                  },
              }
            : {}),
    };

    const [logs, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
            where,
            select: {
                id: true,
                action: true,
                entityType: true,
                entityId: true,
                metadata: true,
                ipAddress: true,
                createdAt: true,
                actor: { select: { id: true, name: true, email: true, role: true } },
            },
            orderBy: [{ createdAt: sortOrder }, { id: "asc" }],
            skip,
            take: limit,
        }),
        prisma.auditLog.count({ where }),
    ]);

    return {
        meta: getMeta(page, limit, total),
        data: logs,
    };
};

export const AuditService = {
    getAuditLogs,
};
