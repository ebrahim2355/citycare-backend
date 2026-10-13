import { randomInt } from "node:crypto";
import type { ComplaintStatus } from "../../generated/prisma/client";
import { OPEN_STATUSES } from "./complaint.constant";

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

export const withOverdue = <T extends { status: ComplaintStatus; dueAt: Date | null }>(complaint: T) => {
    return { ...complaint, isOverdue: isOverdue(complaint) };
};
