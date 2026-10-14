import { ComplaintStatus } from "../../generated/prisma/client";

export const OPEN_STATUSES: ComplaintStatus[] = [ComplaintStatus.SUBMITTED, ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS];

export const ACTIVE_ASSIGNMENT_STATUSES: ComplaintStatus[] = [ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS];

export const CITIZEN_EDITABLE_STATUSES: ComplaintStatus[] = [ComplaintStatus.PENDING_PAYMENT, ComplaintStatus.SUBMITTED];

export const CITIZEN_DELETABLE_STATUSES: ComplaintStatus[] = [ComplaintStatus.CANCELLED, ComplaintStatus.REJECTED, ComplaintStatus.CLOSED];

export const FEEDBACK_STATUSES: ComplaintStatus[] = [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED];

const personSelect = { id: true, name: true, email: true, phone: true } as const;

export const attachmentSelect = {
    id: true,
    kind: true,
    url: true,
    format: true,
    bytes: true,
    createdAt: true,
    uploadedBy: { select: { id: true, name: true, role: true } },
} as const;

export const complaintListSelect = {
    id: true,
    trackingCode: true,
    title: true,
    type: true,
    priority: true,
    status: true,
    area: true,
    fee: true,
    paymentStatus: true,
    dueAt: true,
    submittedAt: true,
    resolvedAt: true,
    createdAt: true,
    category: { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    citizen: { select: { id: true, name: true } },
    assignedStaff: { select: { id: true, name: true } },
} as const;

export const complaintDetailSelect = {
    id: true,
    trackingCode: true,
    title: true,
    description: true,
    type: true,
    priority: true,
    status: true,
    address: true,
    area: true,
    latitude: true,
    longitude: true,
    fee: true,
    paymentStatus: true,
    submittedAt: true,
    assignedAt: true,
    dueAt: true,
    resolvedAt: true,
    closedAt: true,
    resolutionNote: true,
    rejectionReason: true,
    reopenCount: true,
    createdAt: true,
    updatedAt: true,
    category: { select: { id: true, name: true, slaHours: true } },
    department: { select: { id: true, name: true } },
    citizen: { select: personSelect },
    assignedStaff: { select: personSelect },
    feedback: { select: { id: true, rating: true, comment: true, createdAt: true } },
    attachments: {
        where: { deletedAt: null },
        select: attachmentSelect,
        orderBy: { createdAt: "asc" },
    },
    payments: {
        select: { id: true, amount: true, currency: true, status: true, paidAt: true, refundedAt: true, createdAt: true },
        orderBy: { createdAt: "desc" },
    },
    updates: {
        select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            note: true,
            createdAt: true,
            actor: { select: { id: true, name: true, role: true } },
        },
        orderBy: { createdAt: "asc" },
    },
} as const;
