import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { NotificationType, Role } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { complaintLabel, Inbox } from "../notification/notification.inbox";
import { ComplaintService } from "./complaint.service";
import type { TAddCommentPayload } from "./complaint.validation";

const EDIT_WINDOW_MINUTES = 15;

const commentSelect = {
    id: true,
    body: true,
    isInternal: true,
    createdAt: true,
    author: { select: { id: true, name: true, role: true, avatarUrl: true } },
} as const;

const excerpt = (text: string, length = 120) => (text.length > length ? `${text.slice(0, length - 1).trimEnd()}…` : text);

const findViewableComplaint = async (user: IAuthUser, complaintId: string) => {
    const complaint = await prisma.complaint.findFirst({
        where: { id: complaintId, deletedAt: null },
        select: {
            id: true,
            trackingCode: true,
            title: true,
            citizen: { select: { id: true } },
            assignedStaff: { select: { id: true } },
        },
    });

    if (!complaint) {
        throw new AppError(StatusCodes.NOT_FOUND, "Complaint not found", "No complaint found with this id");
    }

    ComplaintService.ensureCanView(user, complaint);

    return complaint;
};

const getComments = async (user: IAuthUser, complaintId: string) => {
    await findViewableComplaint(user, complaintId);

    return prisma.complaintComment.findMany({
        where: { complaintId, deletedAt: null, ...(user.role === Role.CITIZEN ? { isInternal: false } : {}) },
        select: commentSelect,
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
};

const addComment = async (user: IAuthUser, complaintId: string, payload: TAddCommentPayload) => {
    const complaint = await findViewableComplaint(user, complaintId);
    const isInternal = payload.internal ?? false;

    if (isInternal && user.role === Role.CITIZEN) {
        throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "Only the city team can write internal notes");
    }

    return prisma.$transaction(async (tx) => {
        const comment = await tx.complaintComment.create({
            data: { complaintId, authorId: user.id, body: payload.body, isInternal },
            select: commentSelect,
        });
        const message = {
            type: NotificationType.COMMENT_ADDED,
            title: isInternal ? "New internal note" : "New message on a report",
            body: `${comment.author?.name ?? "Someone"} on ${complaintLabel(complaint)}: ${excerpt(payload.body)}`,
            complaintId,
        };

        await Inbox.notify(tx, [isInternal ? null : complaint.citizen.id, complaint.assignedStaff?.id], message, { skipUserId: user.id });

        if (!complaint.assignedStaff) {
            await Inbox.notifyAdmins(tx, message, { skipUserId: user.id });
        }

        return comment;
    });
};

const removeComment = async (user: IAuthUser, complaintId: string, commentId: string, context: IRequestContext) => {
    await findViewableComplaint(user, complaintId);

    const comment = await prisma.complaintComment.findFirst({
        where: { id: commentId, complaintId, deletedAt: null, ...(user.role === Role.CITIZEN ? { isInternal: false } : {}) },
        select: { id: true, authorId: true, createdAt: true },
    });

    if (!comment) {
        throw new AppError(StatusCodes.NOT_FOUND, "Message not found", "No message found with this id on this complaint");
    }

    const isAuthor = comment.authorId === user.id;

    if (!isAuthor && user.role !== Role.ADMIN) {
        throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only remove your own messages");
    }

    if (user.role !== Role.ADMIN && Date.now() - comment.createdAt.getTime() > EDIT_WINDOW_MINUTES * 60 * 1000) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Message can no longer be removed",
            `A message can be removed within ${EDIT_WINDOW_MINUTES} minutes after it is sent`
        );
    }

    await prisma.$transaction(async (tx) => {
        const removed = await tx.complaintComment.updateMany({
            where: { id: commentId, deletedAt: null },
            data: { deletedAt: new Date() },
        });

        if (removed.count === 0) {
            throw new AppError(StatusCodes.NOT_FOUND, "Message not found", "No message found with this id on this complaint");
        }

        await recordAudit(tx, {
            actorId: user.id,
            action: AuditAction.COMMENT_REMOVED,
            entityType: AuditEntity.COMPLAINT,
            entityId: complaintId,
            metadata: { commentId, authorId: comment.authorId },
            ipAddress: context.ipAddress,
        });
    });
};

export const ComplaintComment = {
    getComments,
    addComment,
    removeComment,
};
