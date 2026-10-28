import type { Prisma } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { csvRow } from "../../utils/csv";
import { ComplaintService } from "../complaint/complaint.service";
import { isOverdue } from "../complaint/complaint.utils";
import type { TComplaintQuery } from "../complaint/complaint.validation";
import type { TPaymentQuery } from "../payment/payment.validation";

export const EXPORT_BATCH_SIZE = 500;
export const EXPORT_MAX_ROWS = 10000;

const complaintColumns = [
    "Tracking code",
    "Title",
    "Type",
    "Category",
    "Department",
    "Status",
    "Priority",
    "Area",
    "Address",
    "Latitude",
    "Longitude",
    "Citizen",
    "Citizen email",
    "Citizen phone",
    "Staff member",
    "Fee",
    "Payment status",
    "Public",
    "Supporters",
    "Overdue",
    "Escalated at",
    "Created at",
    "Submitted at",
    "Due at",
    "Resolved at",
    "Closed at",
    "Rating",
];

const complaintExportSelect = {
    id: true,
    trackingCode: true,
    title: true,
    type: true,
    status: true,
    priority: true,
    area: true,
    address: true,
    latitude: true,
    longitude: true,
    fee: true,
    paymentStatus: true,
    isPublic: true,
    escalatedAt: true,
    createdAt: true,
    submittedAt: true,
    dueAt: true,
    resolvedAt: true,
    closedAt: true,
    category: { select: { name: true } },
    department: { select: { name: true } },
    citizen: { select: { name: true, email: true, phone: true } },
    assignedStaff: { select: { name: true } },
    feedback: { select: { rating: true } },
    _count: { select: { supports: true } },
} as const;

const paymentColumns = [
    "Payment id",
    "Tracking code",
    "Request",
    "Citizen",
    "Citizen email",
    "Amount",
    "Currency",
    "Status",
    "Provider",
    "Method",
    "Transaction id",
    "Charged amount",
    "Charged currency",
    "Paid at",
    "Refunded at",
    "Created at",
];

const paymentExportSelect = {
    id: true,
    amount: true,
    currency: true,
    status: true,
    provider: true,
    method: true,
    transactionId: true,
    chargedAmount: true,
    chargedCurrency: true,
    paidAt: true,
    refundedAt: true,
    createdAt: true,
    complaint: { select: { trackingCode: true, title: true } },
    citizen: { select: { name: true, email: true } },
} as const;

type TComplaintExportRow = Prisma.ComplaintGetPayload<{ select: typeof complaintExportSelect }>;
type TPaymentExportRow = Prisma.PaymentGetPayload<{ select: typeof paymentExportSelect }>;

async function* paged<T extends { id: string }>(load: (cursor: string | undefined, take: number) => Promise<T[]>) {
    let sent = 0;
    let cursor: string | undefined;

    while (sent < EXPORT_MAX_ROWS) {
        const batch = await load(cursor, Math.min(EXPORT_BATCH_SIZE, EXPORT_MAX_ROWS - sent));

        yield* batch;

        sent += batch.length;
        cursor = batch.at(-1)?.id;

        if (batch.length < EXPORT_BATCH_SIZE) {
            break;
        }
    }
}

async function* withHeader<T>(columns: string[], items: AsyncGenerator<T>, toRow: (item: T) => unknown[]) {
    const first = await items.next();

    yield csvRow(columns);

    if (first.done) {
        return;
    }

    yield csvRow(toRow(first.value));

    for await (const item of items) {
        yield csvRow(toRow(item));
    }
}

const toComplaintRow = (complaint: TComplaintExportRow) => [
    complaint.trackingCode,
    complaint.title,
    complaint.type,
    complaint.category.name,
    complaint.department.name,
    complaint.status,
    complaint.priority,
    complaint.area,
    complaint.address,
    complaint.latitude,
    complaint.longitude,
    complaint.citizen.name,
    complaint.citizen.email,
    complaint.citizen.phone,
    complaint.assignedStaff?.name,
    Number(complaint.fee).toFixed(2),
    complaint.paymentStatus,
    complaint.isPublic ? "yes" : "no",
    complaint._count.supports,
    isOverdue(complaint) ? "yes" : "no",
    complaint.escalatedAt,
    complaint.createdAt,
    complaint.submittedAt,
    complaint.dueAt,
    complaint.resolvedAt,
    complaint.closedAt,
    complaint.feedback?.rating,
];

const toPaymentRow = (payment: TPaymentExportRow) => [
    payment.id,
    payment.complaint.trackingCode,
    payment.complaint.title,
    payment.citizen.name,
    payment.citizen.email,
    Number(payment.amount).toFixed(2),
    payment.currency.toUpperCase(),
    payment.status,
    payment.provider,
    payment.method,
    payment.transactionId,
    payment.chargedAmount === null ? "" : Number(payment.chargedAmount).toFixed(2),
    payment.chargedCurrency?.toUpperCase() ?? "",
    payment.paidAt,
    payment.refundedAt,
    payment.createdAt,
];

const complaintLines = (admin: IAuthUser, query: TComplaintQuery) => {
    const where = ComplaintService.buildComplaintFilters(admin, query);
    const complaints = paged((cursor, take) =>
        prisma.complaint.findMany({
            where,
            select: complaintExportSelect,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        })
    );

    return withHeader(complaintColumns, complaints, toComplaintRow);
};

const paymentLines = (query: TPaymentQuery) => {
    const where: Prisma.PaymentWhereInput = {
        ...(query.status ? { status: query.status } : {}),
        ...(query.method ? { method: query.method } : {}),
        ...(query.citizenId ? { citizenId: query.citizenId } : {}),
        ...(query.complaintId ? { complaintId: query.complaintId } : {}),
    };
    const payments = paged((cursor, take) =>
        prisma.payment.findMany({
            where,
            select: paymentExportSelect,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        })
    );

    return withHeader(paymentColumns, payments, toPaymentRow);
};

export const ExportService = {
    complaintLines,
    paymentLines,
};
