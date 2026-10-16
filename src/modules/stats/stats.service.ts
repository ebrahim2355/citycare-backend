import config from "../../config";
import { ComplaintStatus, ContactStatus, PaymentStatus, Priority, type Prisma, Role, UserStatus } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { remember } from "../../utils/cache";
import { ACTIVE_ASSIGNMENT_STATUSES, OPEN_STATUSES } from "../complaint/complaint.constant";

const PUBLIC_STATS_SECONDS = 5 * 60;
const ADMIN_STATS_SECONDS = 60;
const TREND_DAYS = 30;
const STAFF_WEEKS = 8;
const RESOLVED_STATUSES: ComplaintStatus[] = [ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED];

interface IDepartmentStats {
    id: string;
    name: string;
    open: number;
    resolved: number;
    overdue: number;
    averageResolutionHours: number | null;
    averageRating: number | null;
}

interface ITrendDay {
    date: string;
    created: number;
    resolved: number;
}

const countByStatus = async (where: Prisma.ComplaintWhereInput) => {
    const groups = await prisma.complaint.groupBy({ by: ["status"], where, _count: { _all: true } });
    const result = Object.fromEntries(Object.values(ComplaintStatus).map((status) => [status, 0])) as Record<ComplaintStatus, number>;

    for (const group of groups) {
        result[group.status] = group._count._all;
    }

    return result;
};

const countByPriority = async (where: Prisma.ComplaintWhereInput) => {
    const groups = await prisma.complaint.groupBy({ by: ["priority"], where, _count: { _all: true } });
    const result = Object.fromEntries(Object.values(Priority).map((priority) => [priority, 0])) as Record<Priority, number>;

    for (const group of groups) {
        result[group.priority] = group._count._all;
    }

    return result;
};

const sumStatuses = (counts: Record<ComplaintStatus, number>, statuses: ComplaintStatus[]) => {
    return statuses.reduce((total, status) => total + counts[status], 0);
};

const roundTo = (value: number | null | undefined, digits: number) => {
    return value === null || value === undefined ? null : Number(value.toFixed(digits));
};

const getAverageResolutionHours = async () => {
    const rows = await prisma.$queryRaw<{ hours: number | null }[]>`
        SELECT AVG(EXTRACT(EPOCH FROM ("resolvedAt" - "submittedAt")) / 3600)::float AS "hours"
        FROM "complaints"
        WHERE "deletedAt" IS NULL AND "resolvedAt" IS NOT NULL AND "submittedAt" IS NOT NULL
    `;

    return roundTo(rows[0]?.hours, 1);
};

const getRecentlyResolved = async () => {
    const complaints = await prisma.complaint.findMany({
        where: { deletedAt: null, status: { in: RESOLVED_STATUSES }, resolvedAt: { not: null } },
        select: {
            id: true,
            title: true,
            area: true,
            submittedAt: true,
            resolvedAt: true,
            category: { select: { name: true } },
            department: { select: { name: true } },
        },
        orderBy: { resolvedAt: "desc" },
        take: 6,
    });

    return complaints.map(({ submittedAt, resolvedAt, category, department, ...complaint }) => ({
        ...complaint,
        category: category.name,
        department: department.name,
        resolvedAt,
        resolutionHours: submittedAt && resolvedAt ? roundTo((resolvedAt.getTime() - submittedAt.getTime()) / (60 * 60 * 1000), 1) : null,
    }));
};

const getPublicStats = () => {
    return remember("stats:public:v2", PUBLIC_STATS_SECONDS, async () => {
        const visible: Prisma.ComplaintWhereInput = {
            deletedAt: null,
            status: { notIn: [ComplaintStatus.PENDING_PAYMENT, ComplaintStatus.CANCELLED] },
        };

        const [byStatus, topCategories, topAreas, averageResolutionHours, recentlyResolved, departmentCount, serviceCount] =
            await Promise.all([
                countByStatus(visible),
                prisma.complaint.groupBy({
                    by: ["categoryId"],
                    where: visible,
                    _count: { _all: true },
                    orderBy: { _count: { categoryId: "desc" } },
                    take: 5,
                }),
                prisma.complaint.groupBy({
                    by: ["area"],
                    where: visible,
                    _count: { _all: true },
                    orderBy: { _count: { area: "desc" } },
                    take: 5,
                }),
                getAverageResolutionHours(),
                getRecentlyResolved(),
                prisma.department.count({ where: { deletedAt: null } }),
                prisma.category.count({ where: { deletedAt: null, isActive: true } }),
            ]);

        const categories = await prisma.category.findMany({
            where: { id: { in: topCategories.map((item) => item.categoryId) } },
            select: { id: true, name: true },
        });
        const categoryNames = new Map(categories.map((category) => [category.id, category.name]));

        const total = Object.values(byStatus).reduce((sum, count) => sum + count, 0);
        const resolved = sumStatuses(byStatus, RESOLVED_STATUSES);

        return {
            totalComplaints: total,
            openComplaints: sumStatuses(byStatus, OPEN_STATUSES),
            resolvedComplaints: resolved,
            resolutionRate: total ? Number(((resolved / total) * 100).toFixed(1)) : 0,
            averageResolutionHours,
            departmentCount,
            serviceCount,
            topCategories: topCategories.map((item) => ({
                categoryId: item.categoryId,
                name: categoryNames.get(item.categoryId) ?? "Unknown",
                complaints: item._count._all,
            })),
            topAreas: topAreas.map((item) => ({ area: item.area, complaints: item._count._all })),
            recentlyResolved,
        };
    });
};

const getDepartmentStats = () => {
    return prisma.$queryRaw<IDepartmentStats[]>`
        SELECT
            d."id",
            d."name",
            COUNT(c."id") FILTER (WHERE c."status" IN ('SUBMITTED', 'ASSIGNED', 'IN_PROGRESS'))::int AS "open",
            COUNT(c."id") FILTER (WHERE c."status" IN ('RESOLVED', 'CLOSED'))::int AS "resolved",
            COUNT(c."id") FILTER (WHERE c."status" IN ('SUBMITTED', 'ASSIGNED', 'IN_PROGRESS') AND c."dueAt" < NOW())::int AS "overdue",
            ROUND((AVG(EXTRACT(EPOCH FROM (c."resolvedAt" - c."submittedAt")) / 3600) FILTER (WHERE c."resolvedAt" IS NOT NULL))::numeric, 1)::float AS "averageResolutionHours",
            ROUND(AVG(f."rating")::numeric, 2)::float AS "averageRating"
        FROM "departments" d
        LEFT JOIN "complaints" c ON c."departmentId" = d."id" AND c."deletedAt" IS NULL
        LEFT JOIN "feedbacks" f ON f."complaintId" = c."id"
        WHERE d."deletedAt" IS NULL
        GROUP BY d."id", d."name"
        ORDER BY d."name" ASC
    `;
};

const getTrend = () => {
    return prisma.$queryRaw<ITrendDay[]>`
        WITH days AS (
            SELECT generate_series(date_trunc('day', NOW()) - make_interval(days => ${TREND_DAYS - 1}), date_trunc('day', NOW()), interval '1 day') AS "day"
        ),
        created AS (
            SELECT date_trunc('day', "createdAt") AS "day", COUNT(*)::int AS "count"
            FROM "complaints"
            WHERE "deletedAt" IS NULL AND "createdAt" >= date_trunc('day', NOW()) - make_interval(days => ${TREND_DAYS - 1})
            GROUP BY 1
        ),
        resolved AS (
            SELECT date_trunc('day', "resolvedAt") AS "day", COUNT(*)::int AS "count"
            FROM "complaints"
            WHERE "deletedAt" IS NULL AND "resolvedAt" >= date_trunc('day', NOW()) - make_interval(days => ${TREND_DAYS - 1})
            GROUP BY 1
        )
        SELECT to_char(days."day", 'YYYY-MM-DD') AS "date", COALESCE(created."count", 0)::int AS "created", COALESCE(resolved."count", 0)::int AS "resolved"
        FROM days
        LEFT JOIN created ON created."day" = days."day"
        LEFT JOIN resolved ON resolved."day" = days."day"
        ORDER BY days."day" ASC
    `;
};

const getAdminStats = () => {
    return remember("stats:admin:v2", ADMIN_STATS_SECONDS, async () => {
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const active: Prisma.ComplaintWhereInput = { deletedAt: null };

        const [
            usersByRole,
            blockedUsers,
            byStatus,
            openByPriority,
            unassigned,
            overdue,
            createdLast7Days,
            payments,
            feedback,
            departments,
            trend,
            newMessages,
        ] = await Promise.all([
            prisma.user.groupBy({ by: ["role"], where: { deletedAt: null }, _count: { _all: true } }),
            prisma.user.count({ where: { deletedAt: null, status: UserStatus.BLOCKED } }),
            countByStatus(active),
            countByPriority({ ...active, status: { in: OPEN_STATUSES } }),
            prisma.complaint.count({ where: { ...active, status: ComplaintStatus.SUBMITTED, assignedStaffId: null } }),
            prisma.complaint.count({ where: { ...active, status: { in: OPEN_STATUSES }, dueAt: { lt: now } } }),
            prisma.complaint.count({ where: { ...active, createdAt: { gte: weekAgo } } }),
            prisma.payment.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
            prisma.feedback.aggregate({ _count: { _all: true }, _avg: { rating: true } }),
            getDepartmentStats(),
            getTrend(),
            prisma.contactMessage.count({ where: { status: ContactStatus.NEW } }),
        ]);

        const roleCount = (role: Role) => usersByRole.find((item) => item.role === role)?._count._all ?? 0;
        const payment = (status: PaymentStatus) => payments.find((item) => item.status === status);

        return {
            users: {
                total: usersByRole.reduce((sum, item) => sum + item._count._all, 0),
                citizens: roleCount(Role.CITIZEN),
                staff: roleCount(Role.STAFF),
                admins: roleCount(Role.ADMIN),
                blocked: blockedUsers,
            },
            complaints: {
                total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
                byStatus,
                openByPriority,
                open: sumStatuses(byStatus, OPEN_STATUSES),
                unassigned,
                overdue,
                createdLast7Days,
            },
            payments: {
                completed: payment(PaymentStatus.COMPLETED)?._count._all ?? 0,
                pending: payment(PaymentStatus.PENDING)?._count._all ?? 0,
                refunded: payment(PaymentStatus.REFUNDED)?._count._all ?? 0,
                revenue: Number(payment(PaymentStatus.COMPLETED)?._sum.amount ?? 0),
                refundedAmount: Number(payment(PaymentStatus.REFUNDED)?._sum.amount ?? 0),
            },
            feedback: {
                total: feedback._count._all,
                averageRating: roundTo(feedback._avg.rating, 2),
            },
            messages: { new: newMessages },
            departments,
            trend,
            generatedAt: now,
        };
    });
};

const getCitizenStats = async (userId: string) => {
    const mine: Prisma.ComplaintWhereInput = { citizenId: userId, deletedAt: null };

    const [byStatus, awaitingFeedback, paid] = await Promise.all([
        countByStatus(mine),
        prisma.complaint.count({ where: { ...mine, status: ComplaintStatus.RESOLVED, feedback: null } }),
        prisma.payment.aggregate({
            where: { citizenId: userId, status: PaymentStatus.COMPLETED },
            _sum: { amount: true },
            _count: { _all: true },
        }),
    ]);

    return {
        role: Role.CITIZEN,
        totalComplaints: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
        byStatus,
        open: sumStatuses(byStatus, OPEN_STATUSES),
        awaitingPayment: byStatus[ComplaintStatus.PENDING_PAYMENT],
        awaitingFeedback,
        resolved: sumStatuses(byStatus, RESOLVED_STATUSES),
        payments: { completed: paid._count._all, totalPaid: Number(paid._sum.amount ?? 0) },
    };
};

const getStaffPerformance = async (userId: string) => {
    const [timing, weeks, ratings] = await Promise.all([
        prisma.$queryRaw<{ averageHours: number | null; resolved: number; onTime: number }[]>`
            SELECT
                AVG(EXTRACT(EPOCH FROM ("resolvedAt" - COALESCE("assignedAt", "submittedAt"))) / 3600)::float AS "averageHours",
                COUNT(*)::int AS "resolved",
                COUNT(*) FILTER (WHERE "dueAt" IS NULL OR "resolvedAt" <= "dueAt")::int AS "onTime"
            FROM "complaints"
            WHERE "assignedStaffId" = ${userId} AND "deletedAt" IS NULL AND "resolvedAt" IS NOT NULL
        `,
        prisma.$queryRaw<{ week: string; resolved: number }[]>`
            WITH weeks AS (
                SELECT generate_series(date_trunc('week', NOW()) - make_interval(weeks => ${STAFF_WEEKS - 1}), date_trunc('week', NOW()), interval '1 week') AS "week"
            ),
            resolved AS (
                SELECT date_trunc('week', "resolvedAt") AS "week", COUNT(*)::int AS "count"
                FROM "complaints"
                WHERE "assignedStaffId" = ${userId} AND "deletedAt" IS NULL AND "resolvedAt" IS NOT NULL
                GROUP BY 1
            )
            SELECT to_char(weeks."week", 'YYYY-MM-DD') AS "week", COALESCE(resolved."count", 0)::int AS "resolved"
            FROM weeks
            LEFT JOIN resolved ON resolved."week" = weeks."week"
            ORDER BY weeks."week" ASC
        `,
        prisma.feedback.groupBy({
            by: ["rating"],
            where: { complaint: { assignedStaffId: userId, deletedAt: null } },
            _count: { _all: true },
        }),
    ]);

    const row = timing[0];

    return {
        averageResolutionHours: roundTo(row?.averageHours, 1),
        onTimeRate: row?.resolved ? Number(((row.onTime / row.resolved) * 100).toFixed(1)) : null,
        resolvedByWeek: weeks,
        ratingBreakdown: [1, 2, 3, 4, 5].map((rating) => ({
            rating,
            count: ratings.find((item) => item.rating === rating)?._count._all ?? 0,
        })),
    };
};

const getStaffStats = async (userId: string) => {
    const mine: Prisma.ComplaintWhereInput = { assignedStaffId: userId, deletedAt: null };
    const now = new Date();

    const [byStatus, overdue, rating, staff, performance] = await Promise.all([
        countByStatus(mine),
        prisma.complaint.count({ where: { ...mine, status: { in: ACTIVE_ASSIGNMENT_STATUSES }, dueAt: { lt: now } } }),
        prisma.feedback.aggregate({ where: { complaint: mine }, _avg: { rating: true }, _count: { _all: true } }),
        prisma.user.findUnique({ where: { id: userId }, select: { acceptsAssignments: true } }),
        getStaffPerformance(userId),
    ]);

    const active = sumStatuses(byStatus, ACTIVE_ASSIGNMENT_STATUSES);

    return {
        role: Role.STAFF,
        activeAssignments: active,
        capacity: config.complaint.maxActiveAssignments,
        acceptsAssignments: staff?.acceptsAssignments ?? true,
        byStatus,
        waitingToStart: byStatus[ComplaintStatus.ASSIGNED],
        inProgress: byStatus[ComplaintStatus.IN_PROGRESS],
        overdue,
        resolved: sumStatuses(byStatus, RESOLVED_STATUSES),
        feedback: { total: rating._count._all, averageRating: roundTo(rating._avg.rating, 2) },
        ...performance,
    };
};

const getMyStats = async (user: IAuthUser) => {
    if (user.role === Role.CITIZEN) {
        return getCitizenStats(user.id);
    }

    if (user.role === Role.STAFF) {
        return getStaffStats(user.id);
    }

    const { data } = await getAdminStats();

    return { role: Role.ADMIN, ...data };
};

export const StatsService = {
    getPublicStats,
    getAdminStats,
    getMyStats,
};
