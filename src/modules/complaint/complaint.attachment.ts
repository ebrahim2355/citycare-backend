import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { AttachmentKind, ComplaintStatus, Role } from "../../generated/prisma/client";
import { deleteImage, ensureUploadConfigured, uploadImage } from "../../lib/cloudinary";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { detectImageType, IMAGE_FIELD } from "../../middlewares/upload";
import { recordAudit } from "../../utils/auditLog";
import type { IRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity } from "../audit/audit.constant";
import { attachmentSelect, CITIZEN_EDITABLE_STATUSES, OPEN_STATUSES } from "./complaint.constant";
import { lockComplaint } from "./complaint.utils";

interface IUploadedFile {
    buffer: Buffer;
    originalname: string;
}

const MAX_ATTACHMENTS_PER_COMPLAINT = 6;
const CITIZEN_UPLOAD_STATUSES: ComplaintStatus[] = [...CITIZEN_EDITABLE_STATUSES, ...OPEN_STATUSES];
const STAFF_UPLOAD_STATUSES: ComplaintStatus[] = [ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS, ComplaintStatus.RESOLVED];

const getUploadKind = (
    user: IAuthUser,
    complaint: { citizenId: string; assignedStaffId: string | null; status: ComplaintStatus }
): AttachmentKind => {
    if (user.role === Role.ADMIN) {
        return AttachmentKind.EVIDENCE;
    }

    if (user.role === Role.CITIZEN) {
        if (complaint.citizenId !== user.id) {
            throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only add images to your own complaints");
        }

        if (!CITIZEN_UPLOAD_STATUSES.includes(complaint.status)) {
            throw new AppError(StatusCodes.CONFLICT, "Images cannot be added now", `This complaint is ${complaint.status}`);
        }

        return AttachmentKind.EVIDENCE;
    }

    if (complaint.assignedStaffId !== user.id) {
        throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only add images to complaints that are assigned to you");
    }

    if (!STAFF_UPLOAD_STATUSES.includes(complaint.status)) {
        throw new AppError(StatusCodes.CONFLICT, "Images cannot be added now", `This complaint is ${complaint.status}`);
    }

    return AttachmentKind.RESOLUTION;
};

const addAttachments = async (user: IAuthUser, complaintId: string, files: IUploadedFile[], context: IRequestContext) => {
    ensureUploadConfigured();

    if (!files.length) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Validation failed", [
            { field: IMAGE_FIELD, message: `Attach at least one image in the "${IMAGE_FIELD}" field` },
        ]);
    }

    const invalidFile = files.find((file) => !detectImageType(file.buffer));

    if (invalidFile) {
        throw new AppError(StatusCodes.BAD_REQUEST, "Invalid file type", [
            { field: IMAGE_FIELD, message: `${invalidFile.originalname} is not a real JPG, PNG or WEBP image` },
        ]);
    }

    const complaint = await prisma.complaint.findFirst({
        where: { id: complaintId, deletedAt: null },
        select: {
            id: true,
            trackingCode: true,
            citizenId: true,
            assignedStaffId: true,
            status: true,
            _count: { select: { attachments: { where: { deletedAt: null } } } },
        },
    });

    if (!complaint) {
        throw new AppError(StatusCodes.NOT_FOUND, "Complaint not found", "No complaint found with this id");
    }

    const kind = getUploadKind(user, complaint);

    if (complaint._count.attachments + files.length > MAX_ATTACHMENTS_PER_COMPLAINT) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Too many images",
            `A complaint can have ${MAX_ATTACHMENTS_PER_COMPLAINT} images at most. It already has ${complaint._count.attachments}.`
        );
    }

    const folder = `citycare/complaints/${complaint.trackingCode}`;
    const uploads = await Promise.allSettled(files.map((file) => uploadImage(file.buffer, folder)));
    const uploaded = uploads.flatMap((upload) => (upload.status === "fulfilled" ? [upload.value] : []));
    const failed = uploads.find((upload) => upload.status === "rejected");

    if (failed) {
        await Promise.all(uploaded.map((image) => deleteImage(image.public_id)));

        throw failed.reason;
    }

    try {
        return await prisma.$transaction(async (tx) => {
            await lockComplaint(tx, complaintId);

            const currentCount = await tx.complaintAttachment.count({ where: { complaintId, deletedAt: null } });

            if (currentCount + uploaded.length > MAX_ATTACHMENTS_PER_COMPLAINT) {
                throw new AppError(
                    StatusCodes.CONFLICT,
                    "Too many images",
                    `A complaint can have ${MAX_ATTACHMENTS_PER_COMPLAINT} images at most. It already has ${currentCount}.`
                );
            }

            const attachments = await tx.complaintAttachment.createManyAndReturn({
                data: uploaded.map((image) => ({
                    complaintId,
                    uploadedById: user.id,
                    kind,
                    url: image.secure_url,
                    publicId: image.public_id,
                    format: image.format,
                    bytes: image.bytes,
                })),
                select: attachmentSelect,
            });

            await recordAudit(tx, {
                actorId: user.id,
                action: AuditAction.ATTACHMENT_ADDED,
                entityType: AuditEntity.COMPLAINT,
                entityId: complaintId,
                metadata: { kind, count: attachments.length },
                ipAddress: context.ipAddress,
            });

            return attachments;
        });
    } catch (error) {
        await Promise.all(uploaded.map((image) => deleteImage(image.public_id)));

        throw error;
    }
};

const removeAttachment = async (user: IAuthUser, complaintId: string, attachmentId: string, context: IRequestContext) => {
    const attachment = await prisma.complaintAttachment.findFirst({
        where: { id: attachmentId, complaintId, deletedAt: null, complaint: { deletedAt: null } },
        select: { id: true, publicId: true, uploadedById: true, complaint: { select: { status: true } } },
    });

    if (!attachment) {
        throw new AppError(StatusCodes.NOT_FOUND, "Image not found", "No image found with this id on this complaint");
    }

    if (user.role !== Role.ADMIN) {
        if (attachment.uploadedById !== user.id) {
            throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only remove images that you uploaded");
        }

        if (![ComplaintStatus.PENDING_PAYMENT, ...OPEN_STATUSES].includes(attachment.complaint.status)) {
            throw new AppError(StatusCodes.CONFLICT, "Image cannot be removed now", "This complaint is already finished");
        }
    }

    await prisma.$transaction(async (tx) => {
        await tx.complaintAttachment.update({ where: { id: attachmentId }, data: { deletedAt: new Date() } });

        await recordAudit(tx, {
            actorId: user.id,
            action: AuditAction.ATTACHMENT_REMOVED,
            entityType: AuditEntity.COMPLAINT,
            entityId: complaintId,
            metadata: { attachmentId },
            ipAddress: context.ipAddress,
        });
    });

    await deleteImage(attachment.publicId);
};

export const ComplaintAttachmentService = {
    addAttachments,
    removeAttachment,
};
