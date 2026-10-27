import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { CategoryType, ComplaintStatus, NotificationType, type Prisma, Role } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { remember } from "../../utils/cache";
import { boundingBox, distanceMeters, roundCoordinate } from "../../utils/geo";
import { complaintLabel, Inbox } from "../notification/notification.inbox";
import { OPEN_STATUSES } from "./complaint.constant";
import { isOverdue, withOverdue } from "./complaint.utils";
import type { TMapQuery, TNearbyQuery, TPublicReportsQuery } from "./complaint.validation";

const PUBLIC_CACHE_SECONDS = 60;
const RESOLVED_DAYS = 90;
const NEARBY_LIMIT = 5;
const SUPPORT_MILESTONES = [1, 5, 10, 25, 50, 100];

const FINISHED_STATUSES: ComplaintStatus[] = [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED];

const publicSelect = {
    id: true,
    trackingCode: true,
    title: true,
    status: true,
    priority: true,
    area: true,
    latitude: true,
    longitude: true,
    dueAt: true,
    createdAt: true,
    resolvedAt: true,
    category: { select: { id: true, name: true } },
    department: { select: { id: true, name: true } },
    _count: { select: { supports: true } },
} as const;

type TPublicRow = Prisma.ComplaintGetPayload<{ select: typeof publicSelect }>;

const toPublicReport = ({ dueAt, _count, latitude, longitude, ...report }: TPublicRow) => ({
    ...report,
    latitude: roundCoordinate(latitude ?? 0),
    longitude: roundCoordinate(longitude ?? 0),
    isOverdue: isOverdue({ status: report.status, dueAt }),
    supportCount: _count.supports,
});

const publicWhere = (): Prisma.ComplaintWhereInput => ({
    deletedAt: null,
    isPublic: true,
    type: CategoryType.COMPLAINT,
    latitude: { not: null },
    longitude: { not: null },
});

const statusFilter = (status: TPublicReportsQuery["status"]): Prisma.ComplaintWhereInput => {
    const recentlyFinished = {
        status: { in: FINISHED_STATUSES },
        resolvedAt: { gte: new Date(Date.now() - RESOLVED_DAYS * 24 * 60 * 60 * 1000) },
    };

    if (status === "RESOLVED") {
        return recentlyFinished;
    }

    if (status === "ALL") {
        return { OR: [{ status: { in: OPEN_STATUSES } }, recentlyFinished] };
    }

    return { status: { in: OPEN_STATUSES } };
};

const getPublicReports = async (query: TPublicReportsQuery) => {
    const key = `public-reports:${JSON.stringify([query.status ?? "OPEN", query.categoryId, query.departmentId, query.minLat, query.maxLat, query.minLng, query.maxLng, query.limit])}`;

    return remember(key, PUBLIC_CACHE_SECONDS, async () => {
        const where: Prisma.ComplaintWhereInput = {
            ...publicWhere(),
            AND: [
                statusFilter(query.status),
                ...(query.minLat !== undefined
                    ? [
                          {
                              latitude: { gte: query.minLat, lte: query.maxLat },
                              longitude: { gte: query.minLng, lte: query.maxLng },
                          },
                      ]
                    : []),
            ],
            ...(query.categoryId ? { categoryId: query.categoryId } : {}),
            ...(query.departmentId ? { departmentId: query.departmentId } : {}),
        };

        const reports = await prisma.complaint.findMany({
            where,
            select: publicSelect,
            orderBy: [{ createdAt: "desc" }, { id: "asc" }],
            take: query.limit ?? 300,
        });

        return reports.map(toPublicReport);
    });
};

const getNearbyReports = async (user: IAuthUser, query: TNearbyQuery) => {
    const center = { latitude: query.latitude, longitude: query.longitude };
    const radius = query.radius ?? 300;
    const box = boundingBox(center, radius);

    const candidates = await prisma.complaint.findMany({
        where: {
            ...publicWhere(),
            status: { in: OPEN_STATUSES },
            latitude: { gte: box.minLat, lte: box.maxLat },
            longitude: { gte: box.minLng, lte: box.maxLng },
            ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        },
        select: { ...publicSelect, citizenId: true, supports: { where: { userId: user.id }, select: { userId: true } } },
        take: 100,
    });

    return candidates
        .map(({ citizenId, supports, ...row }) => ({
            ...toPublicReport(row),
            distanceMeters: Math.round(distanceMeters(center, { latitude: row.latitude ?? 0, longitude: row.longitude ?? 0 })),
            isMine: citizenId === user.id,
            supportedByMe: supports.length > 0,
        }))
        .filter((report) => report.distanceMeters <= radius)
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, NEARBY_LIMIT);
};

const getMapComplaints = async (user: IAuthUser, query: TMapQuery) => {
    const where: Prisma.ComplaintWhereInput = {
        deletedAt: null,
        latitude: { not: null },
        longitude: { not: null },
        ...(query.status === "ALL" ? {} : { status: { in: OPEN_STATUSES } }),
    };

    if (user.role === Role.CITIZEN) {
        where.citizenId = user.id;
    } else if (user.role === Role.STAFF) {
        where.assignedStaffId = user.id;
    } else if (query.departmentId) {
        where.departmentId = query.departmentId;
    }

    const complaints = await prisma.complaint.findMany({
        where,
        select: {
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
            dueAt: true,
            createdAt: true,
            category: { select: { id: true, name: true } },
            department: { select: { id: true, name: true } },
            assignedStaff: { select: { id: true, name: true } },
            _count: { select: { supports: true } },
        },
        orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { id: "asc" }],
        take: query.limit ?? 500,
    });

    return complaints.map(withOverdue);
};

const findSupportable = async (tx: Prisma.TransactionClient, id: string) => {
    const complaint = await tx.complaint.findFirst({
        where: { id, ...publicWhere() },
        select: { id: true, citizenId: true, status: true, trackingCode: true, title: true },
    });

    if (!complaint) {
        throw new AppError(StatusCodes.NOT_FOUND, "Report not found", "No public report found with this id");
    }

    return complaint;
};

const supportComplaint = async (user: IAuthUser, id: string) => {
    return prisma.$transaction(async (tx) => {
        const complaint = await findSupportable(tx, id);

        if (complaint.citizenId === user.id) {
            throw new AppError(StatusCodes.CONFLICT, "You cannot support your own report", "Your report already counts as one voice");
        }

        if (!OPEN_STATUSES.includes(complaint.status)) {
            throw new AppError(StatusCodes.CONFLICT, "This report is already finished", "Only open reports can get support");
        }

        const added = await tx.complaintSupport.createMany({ data: [{ complaintId: id, userId: user.id }], skipDuplicates: true });
        const supportCount = await tx.complaintSupport.count({ where: { complaintId: id } });

        if (added.count === 1 && SUPPORT_MILESTONES.includes(supportCount)) {
            const title = supportCount === 1 ? "A neighbour supports your report" : `${supportCount} people support your report`;
            const alreadyTold = await tx.notification.findFirst({
                where: { userId: complaint.citizenId, complaintId: id, type: NotificationType.REPORT_SUPPORTED, title },
                select: { id: true },
            });

            if (!alreadyTold) {
                await Inbox.notify(tx, [complaint.citizenId], {
                    type: NotificationType.REPORT_SUPPORTED,
                    title,
                    body: `${complaintLabel(complaint)} is getting attention from people nearby.`,
                    complaintId: id,
                });
            }
        }

        return { supportCount, supported: true };
    });
};

const withdrawSupport = async (user: IAuthUser, id: string) => {
    return prisma.$transaction(async (tx) => {
        await findSupportable(tx, id);
        await tx.complaintSupport.deleteMany({ where: { complaintId: id, userId: user.id } });

        return { supportCount: await tx.complaintSupport.count({ where: { complaintId: id } }), supported: false };
    });
};

export const ComplaintCommunity = {
    getPublicReports,
    getNearbyReports,
    getMapComplaints,
    supportComplaint,
    withdrawSupport,
};
