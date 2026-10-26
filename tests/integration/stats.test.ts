import { beforeAll, describe, expect, it } from "vitest";
import { CategoryType, Role } from "../../src/generated/prisma/client";
import { prisma, resetDatabase } from "../helpers/db";
import {
    assignTo,
    createCategory,
    createDepartment,
    createUser,
    type ITestUser,
    moveStatus,
    resolveComplaint,
    submitComplaint,
} from "../helpers/factories";
import { http } from "../helpers/http";

interface IDepartmentStats {
    id: string;
    open: number;
    resolved: number;
    overdue: number;
    averageResolutionHours: number | null;
    averageRating: number | null;
}

interface IAuditEntry {
    action: string;
    metadata: Record<string, unknown> | null;
    actor: { id: string; email: string } | null;
}

const HOUR = 60 * 60 * 1000;

let admin: ITestUser;
let staff: ITestUser;
let c1: ITestUser;
let c2: ITestUser;
let roads: { id: string };
let waste: { id: string };
let closed: { id: string };

const report = (citizen: ITestUser, categoryId: string, area: string, priority = "MEDIUM") =>
    submitComplaint(citizen, categoryId, {
        title: "Something is broken here",
        description: "Please send someone to check it.",
        address: "Road 7, Block C",
        area,
        priority,
    });

const auditLogs = (query: string) => http(admin.token).get(`/admin/audit-logs${query}`);

beforeAll(async () => {
    await resetDatabase();
    roads = await createDepartment("Roads & Transport");
    waste = await createDepartment("Waste Management");

    const pothole = await createCategory(roads.id, { name: "Pothole", slaHours: 48 });
    const garbage = await createCategory(waste.id, { name: "Garbage not collected" });
    const bulk = await createCategory(waste.id, { name: "Bulk waste pickup", type: CategoryType.SERVICE, fee: 15 });

    admin = await createUser({ role: Role.ADMIN, name: "City Admin" });
    staff = await createUser({ role: Role.STAFF, name: "Staff One", departmentId: roads.id });
    c1 = await createUser({ name: "Citizen One" });
    c2 = await createUser({ name: "Citizen Two" });
    closed = await report(c1, pothole.id, "Mirpur", "URGENT");

    const overdue = await report(c1, pothole.id, "Mirpur", "HIGH");

    await report(c2, pothole.id, "Uttara", "LOW");
    await report(c2, garbage.id, "Mirpur");

    const unpaid = await report(c1, bulk.id, "Banani");

    await resolveComplaint(admin, staff, closed.id);
    await assignTo(admin, overdue.id, staff.id);
    await moveStatus(staff, overdue.id, "IN_PROGRESS");
    await prisma.$executeRaw`UPDATE "complaints" SET "submittedAt" = "resolvedAt" - interval '10 hours' WHERE "id" = ${closed.id}`;
    expect((await http(c1.token).post(`/complaints/${closed.id}/feedback`, { rating: 4 })).status).toBe(201);
    await prisma.complaint.update({ where: { id: overdue.id }, data: { dueAt: new Date(Date.now() - HOUR) } });
    expect((await http(c1.token).post(`/complaints/${unpaid.id}/cancel`, {})).status).toBe(200);

    const message = await http().post("/contact", {
        name: "Rina Das",
        email: "rina@example.com",
        subject: "Question",
        message: "When is the garbage collected?",
    });

    expect(message.status).toBe(201);
});

describe("public stats", () => {
    it("counts only submitted requests and needs no login", async () => {
        const res = await http().get("/stats/public");

        expect(res.status).toBe(200);
        expect(res.headers["x-cache"]).toBe("MISS");
        expect(res.body.data).toMatchObject({
            totalComplaints: 4,
            openComplaints: 3,
            resolvedComplaints: 1,
            resolutionRate: 25,
            averageResolutionHours: 10,
            departmentCount: 2,
            serviceCount: 3,
        });
        expect(res.body.data.topCategories[0]).toMatchObject({ name: "Pothole", complaints: 3 });
        expect(res.body.data.topAreas[0]).toEqual({ area: "Mirpur", complaints: 3 });
    });

    it("serves the second read from redis", async () => {
        const res = await http().get("/stats/public");

        expect(res.headers["x-cache"]).toBe("HIT");
        expect(res.body.data.totalComplaints).toBe(4);
    });

    it("shows recently resolved work without personal data", async () => {
        const res = await http().get("/stats/public");
        const resolved = res.body.data.recentlyResolved;

        expect(resolved).toHaveLength(1);
        expect(resolved[0]).toMatchObject({
            id: closed.id,
            category: "Pothole",
            department: "Roads & Transport",
            area: "Mirpur",
            resolutionHours: 10,
        });
        expect(resolved[0]).not.toHaveProperty("citizen");
        expect(resolved[0]).not.toHaveProperty("trackingCode");
        expect(res.text).not.toContain("@test.com");

        for (const name of [c1.name, c2.name, staff.name]) {
            expect(res.text).not.toContain(name);
        }
    });
});

describe("admin dashboard", () => {
    it("is only for admins", async () => {
        expect((await http(c1.token).get("/admin/dashboard-stats")).status).toBe(403);
        expect((await http(staff.token).get("/admin/dashboard-stats")).status).toBe(403);
    });

    it("counts users, complaints, feedback, payments and new messages", async () => {
        const res = await http(admin.token).get("/admin/dashboard-stats");
        const stats = res.body.data;

        expect(res.status).toBe(200);
        expect(res.headers["x-cache"]).toBe("MISS");
        expect(stats.users).toEqual({ total: 4, citizens: 2, staff: 1, admins: 1, blocked: 0 });
        expect(stats.complaints).toMatchObject({ total: 5, open: 3, unassigned: 2, overdue: 1, createdLast7Days: 5 });
        expect(stats.complaints.byStatus).toEqual({
            PENDING_PAYMENT: 0,
            SUBMITTED: 2,
            ASSIGNED: 0,
            IN_PROGRESS: 1,
            RESOLVED: 0,
            CLOSED: 1,
            REJECTED: 0,
            CANCELLED: 1,
        });
        expect(stats.complaints.openByPriority).toEqual({ LOW: 1, MEDIUM: 1, HIGH: 1, URGENT: 0 });
        expect(stats.feedback).toEqual({ total: 1, averageRating: 4 });
        expect(stats.payments).toMatchObject({ completed: 0, revenue: 0 });
        expect(stats.messages).toEqual({ new: 1 });
    });

    it("breaks the numbers down by department", async () => {
        const departments: IDepartmentStats[] = (await http(admin.token).get("/admin/dashboard-stats")).body.data.departments;

        expect(departments.find((item) => item.id === roads.id)).toMatchObject({
            open: 2,
            resolved: 1,
            overdue: 1,
            averageResolutionHours: 10,
            averageRating: 4,
        });
        expect(departments.find((item) => item.id === waste.id)).toMatchObject({
            open: 1,
            resolved: 0,
            overdue: 0,
            averageResolutionHours: null,
            averageRating: null,
        });
    });

    it("shows a 30 day trend that ends today", async () => {
        const trend: { date: string; created: number; resolved: number }[] = (await http(admin.token).get("/admin/dashboard-stats")).body
            .data.trend;

        expect(trend).toHaveLength(30);
        expect(trend.at(-1)).toEqual({ date: new Date().toISOString().slice(0, 10), created: 5, resolved: 1 });
        expect(trend.slice(0, -1).every((day) => day.created === 0 && day.resolved === 0)).toBe(true);
    });

    it("is cached after the first read", async () => {
        const res = await http(admin.token).get("/admin/dashboard-stats");

        expect(res.headers["x-cache"]).toBe("HIT");
        expect(res.body.data.users.total).toBe(4);
    });
});

describe("my stats", () => {
    it("needs a login", async () => {
        expect((await http().get("/stats/me")).status).toBe(401);
    });

    it("shows a citizen their own requests", async () => {
        const mine = (await http(c1.token).get("/stats/me")).body.data;

        expect(mine).toMatchObject({
            role: "CITIZEN",
            totalComplaints: 3,
            open: 1,
            resolved: 1,
            awaitingPayment: 0,
            awaitingFeedback: 0,
            payments: { completed: 0, totalPaid: 0 },
        });
        expect(mine.byStatus.CANCELLED).toBe(1);
        expect((await http(c2.token).get("/stats/me")).body.data).toMatchObject({ totalComplaints: 2, open: 2 });
    });

    it("shows staff their workload", async () => {
        const mine = (await http(staff.token).get("/stats/me")).body.data;

        expect(mine).toMatchObject({
            role: "STAFF",
            activeAssignments: 1,
            capacity: 2,
            acceptsAssignments: true,
            inProgress: 1,
            overdue: 1,
            resolved: 1,
            feedback: { total: 1, averageRating: 4 },
        });
        expect(mine.byStatus.CLOSED).toBe(1);
    });

    it("shows staff their performance", async () => {
        const mine = (await http(staff.token).get("/stats/me")).body.data;
        const weeks: { resolved: number }[] = mine.resolvedByWeek;

        expect(weeks).toHaveLength(8);
        expect(weeks.map((week) => week.resolved)).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
        expect(mine.ratingBreakdown).toEqual([
            { rating: 1, count: 0 },
            { rating: 2, count: 0 },
            { rating: 3, count: 0 },
            { rating: 4, count: 1 },
            { rating: 5, count: 0 },
        ]);
        expect(mine.onTimeRate).toBe(100);
        expect(typeof mine.averageResolutionHours).toBe("number");
    });

    it("gives an admin the dashboard numbers", async () => {
        const mine = (await http(admin.token).get("/stats/me")).body.data;

        expect(mine.role).toBe("ADMIN");
        expect(mine.users.total).toBe(4);
        expect(mine.complaints.total).toBe(5);
    });
});

describe("audit logs", () => {
    it("are only for admins", async () => {
        expect((await http(c1.token).get("/admin/audit-logs")).status).toBe(403);
        expect((await http(staff.token).get("/admin/audit-logs")).status).toBe(403);
    });

    it("list the newest entry first with its actor", async () => {
        const res = await auditLogs("");
        const [newest] = res.body.data as IAuditEntry[];

        expect(res.status).toBe(200);
        expect(res.body.meta.total).toBe(12);
        expect(newest?.action).toBe("COMPLAINT_CANCELLED");
        expect(newest?.actor?.email).toBe(c1.email);
        expect(res.text).not.toContain("password");
    });

    it("filter by action with pagination", async () => {
        const res = await auditLogs("?action=COMPLAINT_ASSIGNED&limit=1");

        expect(res.body.meta.total).toBe(2);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].metadata.staffId).toBe(staff.id);
    });

    it("show the history of one complaint in order", async () => {
        const res = await auditLogs(`?entityType=COMPLAINT&entityId=${closed.id}&sortOrder=asc`);
        const entries = res.body.data as IAuditEntry[];

        expect(entries.map((entry) => entry.action)).toEqual([
            "COMPLAINT_CREATED",
            "COMPLAINT_ASSIGNED",
            "COMPLAINT_STATUS_CHANGED",
            "COMPLAINT_STATUS_CHANGED",
            "FEEDBACK_SUBMITTED",
        ]);
        expect(entries[2]?.metadata).toMatchObject({ from: "ASSIGNED", to: "IN_PROGRESS" });
        expect(entries[3]?.metadata).toMatchObject({ from: "IN_PROGRESS", to: "RESOLVED" });
    });

    it("filter by actor and by date", async () => {
        const byStaff = await auditLogs(`?actorId=${staff.id}`);

        expect(byStaff.body.meta.total).toBe(3);
        expect((byStaff.body.data as IAuditEntry[]).every((entry) => entry.actor?.id === staff.id)).toBe(true);
        expect((await auditLogs(`?from=${new Date(Date.now() + HOUR).toISOString()}`)).body.meta.total).toBe(0);
    });

    it("reject bad filters", async () => {
        for (const query of ["action=NOPE", "entityType=CAR", "entityId=5", "from=x", "limit=500"]) {
            expect((await auditLogs(`?${query}`)).status, query).toBe(400);
        }
    });
});
