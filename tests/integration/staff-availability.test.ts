import { beforeAll, describe, expect, it } from "vitest";
import { Role } from "../../src/generated/prisma/client";
import { prisma, resetDatabase } from "../helpers/db";
import { createCategory, createDepartment, createUser, type ITestUser, moveStatus, submitComplaint } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

let admin: ITestUser;
let onLeave: ITestUser;
let working: ITestUser;
let citizen: ITestUser;
let pothole: { id: string };
let first: { id: string };
let second: { id: string };

const setAvailability = (user: ITestUser, acceptsAssignments: unknown) => http(user.token).patch("/users/me", { acceptsAssignments });

const assign = (complaintId: string, body: object = {}) => http(admin.token).post(`/complaints/${complaintId}/assign`, body);

beforeAll(async () => {
    await resetDatabase();

    const roads = await createDepartment("Roads & Transport");

    pothole = await createCategory(roads.id, { name: "Pothole" });
    admin = await createUser({ role: Role.ADMIN, name: "City Admin" });
    onLeave = await createUser({ role: Role.STAFF, name: "Aaron On Leave", departmentId: roads.id });
    working = await createUser({ role: Role.STAFF, name: "Zara Working", departmentId: roads.id });
    citizen = await createUser({ name: "Karim Citizen" });
    await prisma.user.update({ where: { id: onLeave.id }, data: { createdAt: new Date(Date.now() - 60 * 60 * 1000) } });
});

describe("availability setting", () => {
    it("is on by default for staff", async () => {
        const res = await http(onLeave.token).get("/users/me");

        expect(res.status).toBe(200);
        expect(res.body.data.acceptsAssignments).toBe(true);
    });

    it("must be a boolean", async () => {
        const res = await setAvailability(onLeave, "no");

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "acceptsAssignments")).toBe(true);
    });

    it("lets a staff member pause new assignments", async () => {
        const res = await setAvailability(onLeave, false);

        expect(res.status).toBe(200);
        expect(res.body.data.acceptsAssignments).toBe(false);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: onLeave.id } })).acceptsAssignments).toBe(false);
    });

    it("cannot be set by citizens or admins", async () => {
        for (const user of [citizen, admin]) {
            const res = await setAvailability(user, false);

            expect(res.status, user.role).toBe(400);
            expect(res.body.errors, user.role).toEqual([
                { field: "acceptsAssignments", message: "Only staff members can change their availability" },
            ]);
        }
    });
});

describe("assignment", () => {
    it("skips a paused staff member who is first in line for automatic assignment", async () => {
        first = await submitComplaint(citizen, pothole.id);

        const res = await assign(first.id);

        expect(res.status).toBe(200);
        expect(res.body.data.assignedStaff.id).toBe(working.id);
    });

    it("refuses a manual assignment to a paused staff member with a clear reason", async () => {
        second = await submitComplaint(citizen, pothole.id);

        const res = await assign(second.id, { staffId: onLeave.id });

        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual([{ field: "staffId", message: "This staff member is not taking new complaints right now" }]);
    });

    it("shows the paused staff member as not available in the workload", async () => {
        const res = await http(admin.token).get("/admin/staff-workload");
        const staffById = (id: string) => res.body.data.find((staff: { id: string }) => staff.id === id);

        expect(res.status).toBe(200);
        expect(staffById(onLeave.id)).toMatchObject({ acceptsAssignments: false, isAvailable: false, activeAssignments: 0 });
        expect(staffById(working.id)).toMatchObject({ acceptsAssignments: true, isAvailable: true, activeAssignments: 1, capacity: 2 });
    });

    it("records the change in the audit log", async () => {
        const res = await http(admin.token).get("/admin/audit-logs?action=STAFF_AVAILABILITY_CHANGED");

        expect(res.status).toBe(200);
        expect(res.body.meta.total).toBe(1);
        expect(res.body.data[0]).toMatchObject({
            entityType: "USER",
            entityId: onLeave.id,
            actor: { id: onLeave.id },
            metadata: { acceptsAssignments: false },
        });
    });
});

describe("reopen while the staff member is paused", () => {
    it("puts the complaint back in the queue", async () => {
        await moveStatus(working, first.id, "IN_PROGRESS");
        await moveStatus(working, first.id, "RESOLVED", "The pothole was filled and levelled.");

        expect((await setAvailability(working, false)).status).toBe(200);

        const res = await http(citizen.token).post(`/complaints/${first.id}/reopen`, {
            reason: "The pothole opened again after the rain.",
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "SUBMITTED", assignedStaff: null });
    });
});

describe("resume", () => {
    it("lets a staff member take new complaints again", async () => {
        expect((await assign(second.id)).status).toBe(409);
        expect((await setAvailability(onLeave, true)).status).toBe(200);

        const res = await assign(second.id);

        expect(res.status).toBe(200);
        expect(res.body.data.assignedStaff.id).toBe(onLeave.id);
    });
});
