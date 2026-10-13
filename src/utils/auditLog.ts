import type { Prisma } from "../generated/prisma/client";
import type prisma from "../lib/prisma";
import type { TAuditAction, TAuditEntity } from "../modules/audit/audit.constant";

export type TDbClient = Prisma.TransactionClient | typeof prisma;

export interface IAuditEntry {
    actorId?: string | null | undefined;
    action: TAuditAction;
    entityType: TAuditEntity;
    entityId?: string | null | undefined;
    metadata?: Prisma.InputJsonValue | undefined;
    ipAddress?: string | undefined;
}

export const recordAudit = (db: TDbClient, entry: IAuditEntry) => {
    return db.auditLog.create({
        data: {
            actorId: entry.actorId ?? null,
            action: entry.action,
            entityType: entry.entityType,
            entityId: entry.entityId ?? null,
            ipAddress: entry.ipAddress ?? null,
            ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
        },
    });
};
