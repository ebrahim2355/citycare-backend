import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { ContactStatus, type Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import { getMeta, getPagination } from "../../utils/pagination";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { NotificationService } from "../notification/notification.service";
import type { TCreateMessagePayload, TMessageQuery, TMessageStatusPayload, TReplyPayload } from "./contact.validation";

const messageSelect = {
    id: true,
    name: true,
    email: true,
    topic: true,
    subject: true,
    message: true,
    status: true,
    reply: true,
    repliedAt: true,
    createdAt: true,
    updatedAt: true,
    repliedBy: { select: { id: true, name: true } },
} as const;

const findMessageOrThrow = async (id: string) => {
    const message = await prisma.contactMessage.findUnique({ where: { id }, select: messageSelect });

    if (!message) {
        throw new AppError(StatusCodes.NOT_FOUND, "Message not found", "No contact message found with this id");
    }

    return message;
};

const createMessage = async (payload: TCreateMessagePayload, context: IRequestContext) => {
    const message = await prisma.contactMessage.create({
        data: { ...payload, ipAddress: context.ipAddress ?? null },
        select: messageSelect,
    });

    await NotificationService.contactReceived(message);

    return { id: message.id, topic: message.topic, subject: message.subject, createdAt: message.createdAt };
};

const getMessages = async (query: TMessageQuery) => {
    const { page, limit, skip, sortOrder } = getPagination(query);

    const where: Prisma.ContactMessageWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.topic ? { topic: query.topic } : {}),
        ...(query.searchTerm
            ? {
                  OR: [
                      { name: { contains: query.searchTerm, mode: "insensitive" } },
                      { email: { contains: query.searchTerm, mode: "insensitive" } },
                      { subject: { contains: query.searchTerm, mode: "insensitive" } },
                      { message: { contains: query.searchTerm, mode: "insensitive" } },
                  ],
              }
            : {}),
    };

    const [messages, total] = await prisma.$transaction([
        prisma.contactMessage.findMany({
            where,
            select: messageSelect,
            orderBy: [{ createdAt: sortOrder }, { id: "asc" }],
            skip,
            take: limit,
        }),
        prisma.contactMessage.count({ where }),
    ]);

    return {
        meta: getMeta(page, limit, total),
        data: messages,
    };
};

const replyToMessage = async (admin: IAuthUser, id: string, payload: TReplyPayload, context: IRequestContext) => {
    const message = await findMessageOrThrow(id);

    const emailSent = await NotificationService.contactReply(message, payload.reply);

    const updated = await prisma.$transaction(async (tx) => {
        const saved = await tx.contactMessage.update({
            where: { id },
            data: { reply: payload.reply, repliedAt: new Date(), repliedById: admin.id, status: ContactStatus.REPLIED },
            select: messageSelect,
        });

        await recordAudit(tx, {
            actorId: admin.id,
            action: AuditAction.MESSAGE_REPLIED,
            entityType: AuditEntity.MESSAGE,
            entityId: id,
            metadata: { emailSent, previousStatus: message.status },
            ipAddress: context.ipAddress,
        });

        return saved;
    });

    return { message: updated, emailSent };
};

const updateMessageStatus = async (admin: IAuthUser, id: string, payload: TMessageStatusPayload, context: IRequestContext) => {
    const message = await findMessageOrThrow(id);

    if (message.status === payload.status) {
        throw new AppError(StatusCodes.CONFLICT, "Nothing to change", `This message is already ${payload.status}`);
    }

    return prisma.$transaction(async (tx) => {
        const updated = await tx.contactMessage.update({ where: { id }, data: { status: payload.status }, select: messageSelect });

        await recordAudit(tx, {
            actorId: admin.id,
            action: AuditAction.MESSAGE_STATUS_CHANGED,
            entityType: AuditEntity.MESSAGE,
            entityId: id,
            metadata: { from: message.status, to: payload.status },
            ipAddress: context.ipAddress,
        });

        return updated;
    });
};

export const ContactService = {
    createMessage,
    getMessages,
    replyToMessage,
    updateMessageStatus,
};
