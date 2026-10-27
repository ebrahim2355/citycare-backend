import { NotificationType, Priority } from "../../generated/prisma/client";
import logger from "../../lib/logger";
import prisma from "../../lib/prisma";
import { recordAudit } from "../../utils/auditLog";
import { deleteCacheByPrefix, invalidatePublicReports } from "../../utils/cache";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { complaintLabel, Inbox } from "../notification/notification.inbox";
import { OPEN_STATUSES } from "./complaint.constant";
import { lockComplaint } from "./complaint.utils";

const BATCH_SIZE = 200;
const NOTIFICATION_RETENTION_DAYS = 90;

const NEXT_PRIORITY: Record<Priority, Priority> = {
    [Priority.LOW]: Priority.MEDIUM,
    [Priority.MEDIUM]: Priority.HIGH,
    [Priority.HIGH]: Priority.URGENT,
    [Priority.URGENT]: Priority.URGENT,
};

const escalateComplaint = (id: string, now: Date) => {
    return prisma.$transaction(async (tx) => {
        const locked = await lockComplaint(tx, id, { includeDeleted: true });

        if (locked.deletedAt) {
            return false;
        }

        const complaint = await tx.complaint.findUniqueOrThrow({
            where: { id },
            select: {
                status: true,
                priority: true,
                dueAt: true,
                escalatedAt: true,
                trackingCode: true,
                title: true,
                assignedStaffId: true,
                department: { select: { name: true } },
            },
        });

        if (complaint.escalatedAt || !OPEN_STATUSES.includes(complaint.status) || !complaint.dueAt || complaint.dueAt >= now) {
            return false;
        }

        const priority = NEXT_PRIORITY[complaint.priority];
        const note =
            priority === complaint.priority
                ? "Deadline missed. Flagged for the city team."
                : `Deadline missed. Priority raised from ${complaint.priority} to ${priority}.`;

        await tx.complaint.update({ where: { id }, data: { escalatedAt: now, priority } });

        await tx.complaintUpdate.create({
            data: { complaintId: id, actorId: null, fromStatus: complaint.status, toStatus: complaint.status, note },
        });

        await recordAudit(tx, {
            actorId: null,
            action: AuditAction.COMPLAINT_ESCALATED,
            entityType: AuditEntity.COMPLAINT,
            entityId: id,
            metadata: { from: complaint.priority, to: priority, dueAt: complaint.dueAt.toISOString() },
        });

        const message = {
            type: NotificationType.SLA_BREACHED,
            title: "A report missed its deadline",
            body: `${complaintLabel(complaint)} in ${complaint.department.name} is overdue. ${note}`,
            complaintId: id,
        };

        await Inbox.notifyAdmins(tx, message);
        await Inbox.notify(tx, [complaint.assignedStaffId], { ...message, title: "One of your jobs is overdue" });

        return true;
    });
};

const runSlaCheck = async (now = new Date()) => {
    const overdue = await prisma.complaint.findMany({
        where: { deletedAt: null, status: { in: OPEN_STATUSES }, dueAt: { lt: now }, escalatedAt: null },
        select: { id: true },
        orderBy: { dueAt: "asc" },
        take: BATCH_SIZE,
    });

    let escalated = 0;
    let failed = 0;

    for (const { id } of overdue) {
        try {
            if (await escalateComplaint(id, now)) {
                escalated++;
            }
        } catch (error) {
            failed++;
            logger.error({ err: error, complaintId: id }, "Escalation failed");
        }
    }

    const pruned = await prisma.notification.deleteMany({
        where: { readAt: { lt: new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000) } },
    });

    if (escalated) {
        await Promise.all([deleteCacheByPrefix("stats:"), invalidatePublicReports()]);
    }

    return { checked: overdue.length, escalated, failed, prunedNotifications: pruned.count, ranAt: now };
};

export const ComplaintEscalation = {
    runSlaCheck,
};
