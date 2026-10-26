import { beforeAll, describe, expect, it } from "vitest";
import { ComplaintStatus, UserStatus } from "../../src/generated/prisma/client";
import { prisma, resetDatabase } from "../helpers/db";
import { assignTo, createCity, type ITestUser, moveStatus, submitComplaint } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

interface IComplaint {
    id: string;
    trackingCode: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let admin: ITestUser;
let citizen: ITestUser;
let citizen2: ITestUser;
let roadsStaff: ITestUser;
let roadsStaff2: ITestUser;
let pothole: { id: string };
let light: { id: string };
let bulk: { id: string };
let free: IComplaint;
let lightOne: IComplaint;
let other: IComplaint;
let paid: IComplaint;
let toCancel: IComplaint;
let taken: IComplaint;

const changeStatus = (user: ITestUser, complaintId: string, body: object) =>
    http(user.token).patch(`/complaints/${complaintId}/status`, body);

const reopen = (user: ITestUser, complaintId: string, body: object) => http(user.token).post(`/complaints/${complaintId}/reopen`, body);

const cancel = (user: ITestUser, complaintId: string, body: object = {}) =>
    http(user.token).post(`/complaints/${complaintId}/cancel`, body);

const setStaffStatus = (staff: ITestUser, status: UserStatus) => prisma.user.update({ where: { id: staff.id }, data: { status } });

beforeAll(async () => {
    await resetDatabase();
    ({ admin, citizen, citizen2, roadsStaff, roadsStaff2, pothole, light, bulk } = await createCity());
    free = await submitComplaint(citizen, pothole.id, { priority: "HIGH" });
    lightOne = await submitComplaint(citizen, light.id, { title: "Street light broken for a week", area: "Uttara" });
    other = await submitComplaint(citizen2, pothole.id, { title: "Road surface damaged after rain", area: "Dhanmondi" });
    paid = await submitComplaint(citizen, bulk.id, { title: "Old sofa and fridge pickup" });
    await assignTo(admin, free.id, roadsStaff.id);
    await assignTo(admin, free.id, roadsStaff2.id);
});

describe("status changes", () => {
    it("are allowed only for the assigned staff member and admins", async () => {
        expect((await changeStatus(citizen, free.id, { status: "IN_PROGRESS" })).status).toBe(403);
        expect((await changeStatus(roadsStaff, free.id, { status: "IN_PROGRESS" })).status).toBe(403);
    });

    it("accept only known target statuses", async () => {
        const res = await changeStatus(roadsStaff2, free.id, { status: "DONE" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "status")).toBe(true);
    });

    it("cannot skip the in progress step", async () => {
        const res = await changeStatus(roadsStaff2, free.id, { status: "RESOLVED", note: "Fixed without starting the work first" });

        expect(res.status).toBe(409);
        expect(res.body.errors[0].message).toContain("Allowed next status: IN_PROGRESS");
    });

    it("let the staff member start the work", async () => {
        const res = await changeStatus(roadsStaff2, free.id, { status: "IN_PROGRESS" });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("IN_PROGRESS");
    });

    it("need a note to resolve", async () => {
        const res = await changeStatus(roadsStaff2, free.id, { status: "RESOLVED" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "note")).toBe(true);
    });

    it("keep rejecting for admins and resolving for staff", async () => {
        const staffRejects = await changeStatus(roadsStaff2, free.id, { status: "REJECTED", note: "Staff should not be able to reject" });
        const adminResolves = await changeStatus(admin, free.id, { status: "RESOLVED", note: "Admin tries to resolve it directly" });

        expect(staffRejects.status).toBe(409);
        expect(adminResolves.status).toBe(409);
    });

    it("resolve the complaint with the note and keep every step on the timeline", async () => {
        const res = await changeStatus(roadsStaff2, free.id, {
            status: "RESOLVED",
            note: "The pothole was filled and the road was levelled.",
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            status: "RESOLVED",
            resolutionNote: "The pothole was filled and the road was levelled.",
            isOverdue: false,
        });
        expect(res.body.data.resolvedAt).not.toBeNull();
        expect(res.body.data.updates.map((update: { toStatus: string }) => update.toStatus)).toEqual([
            "SUBMITTED",
            "ASSIGNED",
            "ASSIGNED",
            "IN_PROGRESS",
            "RESOLVED",
        ]);
        expect(res.body.data.updates.map((update: { actor: { id: string } }) => update.actor.id)).toEqual([
            citizen.id,
            admin.id,
            admin.id,
            roadsStaff2.id,
            roadsStaff2.id,
        ]);
    });

    it("need a reason to reject", async () => {
        const res = await changeStatus(admin, lightOne.id, { status: "REJECTED" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "note")).toBe(true);
    });

    it("let an admin reject an open complaint with the reason", async () => {
        const res = await changeStatus(admin, lightOne.id, {
            status: "REJECTED",
            note: "This light belongs to a private housing society.",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Complaint status changed to REJECTED.");
        expect(res.body.data).toMatchObject({ status: "REJECTED", rejectionReason: "This light belongs to a private housing society." });
        expect(res.body.data.closedAt).not.toBeNull();
    });

    it("do not close a rejected complaint", async () => {
        expect((await changeStatus(admin, lightOne.id, { status: "CLOSED" })).status).toBe(409);
    });
});

describe("reopen", () => {
    it("is possible only for a resolved complaint", async () => {
        expect((await reopen(citizen2, other.id, { reason: "It is not resolved yet at all" })).status).toBe(409);
    });

    it("is possible only for the citizen who owns the complaint, with a reason", async () => {
        const noReason = await reopen(citizen, free.id, {});

        expect((await reopen(citizen2, free.id, { reason: "Someone else tries to reopen" })).status).toBe(403);
        expect(noReason.status).toBe(400);
        expect(hasFieldError(noReason, "reason")).toBe(true);
    });

    it("gives the work back to the same staff member with a new due date", async () => {
        const res = await reopen(citizen, free.id, { reason: "The pothole opened again after two days." });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            status: "IN_PROGRESS",
            assignedStaff: { id: roadsStaff2.id },
            reopenCount: 1,
            resolvedAt: null,
            resolutionNote: null,
        });
        expect(Date.parse(res.body.data.dueAt)).toBeGreaterThan(Date.now() + 47 * HOUR);
        expect(res.body.data.updates.at(-1)).toMatchObject({
            fromStatus: "RESOLVED",
            toStatus: "IN_PROGRESS",
            note: "Reopened by the citizen: The pothole opened again after two days.",
            actor: { id: citizen.id },
        });
    });

    it("puts the complaint back in the queue when the staff member was blocked", async () => {
        await moveStatus(roadsStaff2, free.id, "RESOLVED", "Filled again with a stronger mix.");
        await setStaffStatus(roadsStaff2, UserStatus.BLOCKED);

        try {
            const res = await reopen(citizen, free.id, { reason: "Still broken, please send someone." });

            expect(res.status).toBe(200);
            expect(res.body.data).toMatchObject({ status: "SUBMITTED", assignedStaff: null, assignedAt: null, reopenCount: 2 });
        } finally {
            await setStaffStatus(roadsStaff2, UserStatus.ACTIVE);
        }
    });

    it("is refused after the maximum number of reopens", async () => {
        await prisma.complaint.update({ where: { id: free.id }, data: { status: ComplaintStatus.RESOLVED, resolvedAt: new Date() } });

        const res = await reopen(citizen, free.id, { reason: "Third time should be refused." });

        expect(res.status).toBe(409);
        expect(res.body.errors[0].message).toContain("2 times at most");
    });

    it("is refused after the reopen window of 7 days", async () => {
        await prisma.complaint.update({ where: { id: free.id }, data: { reopenCount: 0, resolvedAt: new Date(Date.now() - 8 * DAY) } });

        const res = await reopen(citizen, free.id, { reason: "Too late to reopen this one." });

        expect(res.status).toBe(409);
        expect(res.body.errors[0].message).toContain("within 7 days");
    });

    it("ends when an admin closes the resolved complaint", async () => {
        const res = await changeStatus(admin, free.id, { status: "CLOSED" });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("CLOSED");
        expect(res.body.data.closedAt).not.toBeNull();
        expect((await reopen(citizen, free.id, { reason: "Trying to reopen a closed complaint." })).status).toBe(409);
    });
});

describe("overdue", () => {
    it("flags an open complaint after its due date", async () => {
        await prisma.complaint.update({ where: { id: other.id }, data: { dueAt: new Date(Date.now() - 2 * HOUR) } });

        const detail = await http(admin.token).get(`/complaints/${other.id}`);
        const overdue = await http(admin.token).get("/complaints?overdue=true");

        expect(detail.body.data.isOverdue).toBe(true);
        expect(overdue.body.data.map((item: { id: string }) => item.id)).toEqual([other.id]);
        expect(overdue.body.data[0].isOverdue).toBe(true);
    });

    it("stops counting a complaint once it is finished", async () => {
        const res = await changeStatus(admin, other.id, { status: "REJECTED", note: "Duplicate of an older complaint on this road." });

        expect(res.status).toBe(200);
        expect(res.body.data.isOverdue).toBe(false);
        expect((await http(admin.token).get("/complaints?overdue=true")).body.meta.total).toBe(0);
    });
});

describe("cancel", () => {
    beforeAll(async () => {
        toCancel = await submitComplaint(citizen2, pothole.id, { title: "Complaint that will be cancelled" });
        taken = await submitComplaint(citizen2, pothole.id, { title: "Complaint already taken by the staff" });
        await assignTo(admin, taken.id, roadsStaff.id);
    });

    it("is allowed only for the citizen who owns the complaint", async () => {
        expect((await cancel(citizen, toCancel.id)).status).toBe(403);
        expect((await cancel(admin, toCancel.id)).status).toBe(403);
    });

    it("is refused once a staff member is assigned", async () => {
        expect((await cancel(citizen2, taken.id)).status).toBe(409);
    });

    it("needs a reason of at least 5 characters when one is given", async () => {
        const res = await cancel(citizen2, toCancel.id, { reason: "abc" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "reason")).toBe(true);
    });

    it("cancels the complaint with the reason on the timeline", async () => {
        const res = await cancel(citizen2, toCancel.id, { reason: "It was fixed by the neighbours" });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("CANCELLED");
        expect(res.body.data.closedAt).not.toBeNull();
        expect(res.body.data.updates.at(-1)).toMatchObject({
            fromStatus: "SUBMITTED",
            toStatus: "CANCELLED",
            note: "It was fixed by the neighbours",
            actor: { id: citizen2.id },
        });
    });

    it("cannot cancel twice", async () => {
        expect((await cancel(citizen2, toCancel.id)).status).toBe(409);
    });

    it("cancels an unpaid service request without any payment to settle", async () => {
        const res = await cancel(citizen, paid.id);

        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Complaint cancelled successfully.");
        expect(res.body.data).toMatchObject({ status: "CANCELLED", paymentStatus: "UNPAID", payments: [] });
        expect(res.body.data.updates.at(-1)).toMatchObject({ fromStatus: "PENDING_PAYMENT", note: "Cancelled by the citizen" });
    });
});

describe("audit trail", () => {
    it("records status changes, reopens and cancellations with their actors", async () => {
        const logs = await prisma.auditLog.findMany({ where: { entityType: "COMPLAINT" }, orderBy: { createdAt: "asc" } });
        const rows = (action: string, entityId: string) =>
            logs
                .filter((log) => log.action === action && log.entityId === entityId)
                .map((log) => ({ actorId: log.actorId, metadata: log.metadata }));

        expect(rows("COMPLAINT_STATUS_CHANGED", free.id)).toEqual([
            { actorId: roadsStaff2.id, metadata: { from: "ASSIGNED", to: "IN_PROGRESS" } },
            { actorId: roadsStaff2.id, metadata: { from: "IN_PROGRESS", to: "RESOLVED" } },
            { actorId: roadsStaff2.id, metadata: { from: "IN_PROGRESS", to: "RESOLVED" } },
            { actorId: admin.id, metadata: { from: "RESOLVED", to: "CLOSED" } },
        ]);
        expect(rows("COMPLAINT_REOPENED", free.id)).toEqual([
            { actorId: citizen.id, metadata: { to: "IN_PROGRESS", reopenCount: 1 } },
            { actorId: citizen.id, metadata: { to: "SUBMITTED", reopenCount: 2 } },
        ]);
        expect(rows("COMPLAINT_CANCELLED", toCancel.id)).toEqual([{ actorId: citizen2.id, metadata: { from: "SUBMITTED" } }]);
        expect(rows("COMPLAINT_CANCELLED", paid.id)).toEqual([{ actorId: citizen.id, metadata: { from: "PENDING_PAYMENT" } }]);
    });
});
