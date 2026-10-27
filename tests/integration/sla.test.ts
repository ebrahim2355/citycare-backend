import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ComplaintStatus, Priority, Role } from "../../src/generated/prisma/client";
import { prisma, resetDatabase } from "../helpers/db";
import { assignTo, createCity, createUser, type ITestUser, resolveComplaint, submitComplaint } from "../helpers/factories";
import { http } from "../helpers/http";

type TCity = Awaited<ReturnType<typeof createCity>>;

const CRON = { Authorization: "Bearer citycare-test-cron-secret" };
const HOUR = 60 * 60 * 1000;

let city: TCity;
let secondAdmin: ITestUser;
let waiting: { id: string };
let urgent: { id: string };
let onTime: { id: string };
let finished: { id: string };
let alreadyFlagged: { id: string };

const setDue = (id: string, hoursFromNow: number, extra: Record<string, unknown> = {}) => {
    return prisma.complaint.update({ where: { id }, data: { dueAt: new Date(Date.now() + hoursFromNow * HOUR), ...extra } });
};

const cron = () => http(undefined, CRON).get("/jobs/sla-check");

beforeAll(async () => {
    await resetDatabase();
    city = await createCity();
    secondAdmin = await createUser({ role: Role.ADMIN, name: "Second Admin" });

    waiting = await submitComplaint(city.citizen, city.pothole.id, { title: "Hole nobody picked up", priority: "MEDIUM" });
    urgent = await submitComplaint(city.citizen, city.light.id, { title: "Dark junction near the hospital", priority: "URGENT" });
    onTime = await submitComplaint(city.citizen2, city.pothole.id, { title: "Small hole near the park" });
    finished = await submitComplaint(city.citizen2, city.pothole.id, { title: "Hole that was fixed late" });
    alreadyFlagged = await submitComplaint(city.citizen2, city.garbage.id, { title: "Bins full for a week" });

    await assignTo(city.admin, urgent.id, city.roadsStaff.id);
    await resolveComplaint(city.admin, city.roadsStaff2, finished.id);
    await setDue(waiting.id, -5);
    await setDue(urgent.id, -1);
    await setDue(onTime.id, 10);
    await setDue(finished.id, -30);
    await setDue(alreadyFlagged.id, -3, { escalatedAt: new Date(Date.now() - HOUR) });
});

describe("the scheduled deadline check", () => {
    it("only runs with the cron secret", async () => {
        expect((await http().get("/jobs/sla-check")).status).toBe(401);
        expect((await http(undefined, { Authorization: "Bearer wrong-secret" }).get("/jobs/sla-check")).status).toBe(401);
        expect((await http(city.admin.token).get("/jobs/sla-check")).status).toBe(401);
    });

    it("escalates each open complaint that missed its deadline", async () => {
        const res = await cron();

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ checked: 2, escalated: 2, prunedNotifications: 0 });
        expect(res.body.message).toBe("2 overdue complaints were escalated");
    });

    it("raises the priority one level and writes the timeline and the audit log", async () => {
        const rows = await prisma.complaint.findMany({
            where: { id: { in: [waiting.id, urgent.id, onTime.id, finished.id] } },
            select: { id: true, priority: true, escalatedAt: true, status: true },
        });
        const byId = Object.fromEntries(rows.map((row) => [row.id, row]));

        expect(byId[waiting.id]).toMatchObject({ priority: Priority.HIGH, escalatedAt: expect.any(Date) });
        expect(byId[urgent.id]).toMatchObject({ priority: Priority.URGENT, escalatedAt: expect.any(Date) });
        expect(byId[onTime.id]?.escalatedAt).toBeNull();
        expect(byId[finished.id]).toMatchObject({ status: ComplaintStatus.RESOLVED, escalatedAt: null });

        const timeline = await prisma.complaintUpdate.findMany({ where: { complaintId: { in: [waiting.id, urgent.id] }, actorId: null } });

        expect(timeline.map((row) => row.note).sort()).toEqual([
            "Deadline missed. Flagged for the city team.",
            "Deadline missed. Priority raised from MEDIUM to HIGH.",
        ]);

        const audit = await prisma.auditLog.findMany({ where: { action: "COMPLAINT_ESCALATED" } });

        expect(audit).toHaveLength(2);
        expect(audit.every((row) => row.actorId === null)).toBe(true);
    });

    it("tells every admin and the assigned staff member", async () => {
        const told = async (user: { id: string }) =>
            (await prisma.notification.findMany({ where: { userId: user.id, type: "SLA_BREACHED" } }))
                .map((item) => item.complaintId)
                .sort();

        expect(await told(city.admin)).toEqual([waiting.id, urgent.id].sort());
        expect(await told(secondAdmin)).toEqual([waiting.id, urgent.id].sort());
        expect(await told(city.roadsStaff)).toEqual([urgent.id]);
        expect(await told(city.citizen)).toEqual([]);
    });

    it("does nothing the second time", async () => {
        const res = await cron();

        expect(res.body.data).toMatchObject({ checked: 0, escalated: 0 });
    });
});

describe("after the check", () => {
    it("lets admins filter escalated complaints and run the check by hand", async () => {
        const escalated = await http(city.admin.token).get("/complaints?escalated=true");

        expect(escalated.body.data.map((item: { id: string }) => item.id).sort()).toEqual(
            [waiting.id, urgent.id, alreadyFlagged.id].sort()
        );
        expect(escalated.body.data[0].escalatedAt).toEqual(expect.any(String));
        expect((await http(city.citizen.token).post("/admin/sla-check")).status).toBe(403);

        const manual = await http(city.admin.token).post("/admin/sla-check");

        expect(manual.status).toBe(200);
        expect(manual.body.data.escalated).toBe(0);
    });

    it("counts open escalated complaints on the admin dashboard", async () => {
        const res = await http(city.admin.token).get("/admin/dashboard-stats");

        expect(res.body.data.complaints.escalated).toBe(3);
    });

    it("clears the flag when a resolved complaint is reopened with a new deadline", async () => {
        await prisma.complaint.update({ where: { id: finished.id }, data: { escalatedAt: new Date() } });

        const res = await http(city.citizen2.token).post(`/complaints/${finished.id}/reopen`, {
            reason: "The hole opened again after the rain.",
        });

        expect(res.status).toBe(200);
        expect(res.body.data.escalatedAt).toBeNull();
        expect(new Date(res.body.data.dueAt).getTime()).toBeGreaterThan(Date.now());
    });

    it("removes read notifications older than 90 days", async () => {
        const old = new Date(Date.now() - 100 * 24 * HOUR);

        await prisma.notification.createMany({
            data: [
                { userId: city.citizen.id, type: "COMPLAINT_ASSIGNED", title: "Old and read", body: "x", createdAt: old, readAt: old },
                { userId: city.citizen.id, type: "COMPLAINT_ASSIGNED", title: "Old but unread", body: "x", createdAt: old },
            ],
        });

        const res = await cron();
        const titles = (await prisma.notification.findMany({ where: { userId: city.citizen.id } })).map((item) => item.title);

        expect(res.body.data.prunedNotifications).toBe(1);
        expect(titles).toContain("Old but unread");
        expect(titles).not.toContain("Old and read");
    });
});

describe("without a cron secret", () => {
    let app: Parameters<typeof request>[0];
    let freshPrisma: { $disconnect: () => Promise<void> };

    beforeAll(async () => {
        vi.stubEnv("CRON_SECRET", "");
        vi.resetModules();
        app = (await import("../../src/app")).default;
        freshPrisma = (await import("../../src/lib/prisma")).default;
    });

    afterAll(async () => {
        await freshPrisma.$disconnect();
        vi.unstubAllEnvs();
    });

    it("answers 503 instead of running", async () => {
        const res = await request(app).get("/api/v1/jobs/sla-check").set(CRON);

        expect(res.status).toBe(503);
        expect(res.body.message).toBe("Scheduled jobs are not configured");
    });
});
