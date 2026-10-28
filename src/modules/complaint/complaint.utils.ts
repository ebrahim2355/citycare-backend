import { randomInt } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import type { ComplaintPaymentStatus, ComplaintStatus, Prisma } from "../../generated/prisma/client";
import { complaintDetailSelect, OPEN_STATUSES } from "./complaint.constant";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const generateTrackingCode = (now = new Date()) => {
    const datePart = now.toISOString().slice(2, 10).replace(/-/g, "");
    let randomPart = "";

    for (let index = 0; index < 6; index++) {
        randomPart += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }

    return `CC-${datePart}-${randomPart}`;
};

export const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

export const isOverdue = (complaint: { status: ComplaintStatus; dueAt: Date | null }, now = new Date()) => {
    return Boolean(complaint.dueAt && complaint.dueAt < now && OPEN_STATUSES.includes(complaint.status));
};

export const withOverdue = <T extends { status: ComplaintStatus; dueAt: Date | null; _count?: { supports: number } }>(complaint: T) => {
    const { _count, ...rest } = complaint;

    return { ...rest, isOverdue: isOverdue(complaint), ...(_count ? { supportCount: _count.supports } : {}) };
};

export interface ILockedComplaint {
    id: string;
    trackingCode: string;
    status: ComplaintStatus;
    paymentStatus: ComplaintPaymentStatus;
    citizenId: string;
    departmentId: string;
    categoryId: string;
    assignedStaffId: string | null;
    deletedAt: Date | null;
}

export const lockComplaint = async (
    tx: Prisma.TransactionClient,
    id: string,
    options: { includeDeleted?: boolean } = {}
): Promise<ILockedComplaint> => {
    const rows = await tx.$queryRaw<ILockedComplaint[]>`
        SELECT "id", "trackingCode", "status", "paymentStatus", "citizenId", "departmentId", "categoryId", "assignedStaffId", "deletedAt"
        FROM "complaints"
        WHERE "id" = ${id}
        FOR UPDATE
    `;

    const complaint = rows[0];

    if (!complaint || (complaint.deletedAt && !options.includeDeleted)) {
        throw new AppError(StatusCodes.NOT_FOUND, "Complaint not found", "No complaint found with this id");
    }

    return complaint;
};

export const getComplaintDetail = async (tx: Prisma.TransactionClient, id: string) => {
    const complaint = await tx.complaint.findUniqueOrThrow({ where: { id }, select: complaintDetailSelect });

    return withOverdue(complaint);
};
