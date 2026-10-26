import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { type NotificationType, Role, UserStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import type { TDbClient } from "../../utils/auditLog";
import { getMeta, getPagination } from "../../utils/pagination";
import type { TNotificationQuery } from "./notification.validation";

export interface IInboxMessage {
    type: NotificationType;
    title: string;
    body: string;
    complaintId?: string | null;
}

interface INotifyOptions {
    skipUserId?: string | null;
}

const notificationSelect = {
    id: true,
    type: true,
    title: true,
    body: true,
    readAt: true,
    createdAt: true,
    complaint: { select: { id: true, trackingCode: true } },
} as const;

export const complaintLabel = (complaint: { trackingCode: string; title: string }) => `${complaint.trackingCode} · ${complaint.title}`;

const notify = async (db: TDbClient, userIds: (string | null | undefined)[], message: IInboxMessage, options: INotifyOptions = {}) => {
    const recipients = [...new Set(userIds.filter((id): id is string => Boolean(id) && id !== options.skipUserId))];

    if (!recipients.length) {
        return;
    }

    await db.notification.createMany({
        data: recipients.map((userId) => ({
            userId,
            type: message.type,
            title: message.title,
            body: message.body,
            complaintId: message.complaintId ?? null,
        })),
    });
};

const adminIds = async (db: TDbClient) => {
    const admins = await db.user.findMany({
        where: { role: Role.ADMIN, status: UserStatus.ACTIVE, deletedAt: null },
        select: { id: true },
    });

    return admins.map((admin) => admin.id);
};

const notifyAdmins = async (db: TDbClient, message: IInboxMessage, options: INotifyOptions = {}) => {
    await notify(db, await adminIds(db), message, options);
};

const getNotifications = async (user: IAuthUser, query: TNotificationQuery) => {
    const { page, limit, skip } = getPagination(query);
    const where = { userId: user.id, ...(query.unread === "true" ? { readAt: null } : {}) };

    const [notifications, total] = await prisma.$transaction([
        prisma.notification.findMany({
            where,
            select: notificationSelect,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip,
            take: limit,
        }),
        prisma.notification.count({ where }),
    ]);

    return { meta: getMeta(page, limit, total), data: notifications };
};

const getUnreadCount = async (user: IAuthUser) => {
    return { count: await prisma.notification.count({ where: { userId: user.id, readAt: null } }) };
};

const markRead = async (user: IAuthUser, id: string) => {
    const notification = await prisma.notification.findFirst({ where: { id, userId: user.id }, select: { id: true, readAt: true } });

    if (!notification) {
        throw new AppError(StatusCodes.NOT_FOUND, "Notification not found", "No notification found with this id");
    }

    if (notification.readAt) {
        return prisma.notification.findUniqueOrThrow({ where: { id }, select: notificationSelect });
    }

    return prisma.notification.update({ where: { id }, data: { readAt: new Date() }, select: notificationSelect });
};

const markAllRead = async (user: IAuthUser) => {
    const result = await prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });

    return { count: result.count };
};

export const Inbox = {
    notify,
    notifyAdmins,
    getNotifications,
    getUnreadCount,
    markRead,
    markAllRead,
};
