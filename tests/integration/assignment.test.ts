import { beforeAll, describe, expect, it } from "vitest";
import { ComplaintStatus, Role, UserStatus } from "../../src/generated/prisma/client";
import { prisma, resetDatabase } from "../helpers/db";
import {
    createCategory,
    createCity,
    createDepartment,
    createUser,
    type ITestUser,
    MISSING_ID,
    moveStatus,
    resolveComplaint,
    submitComplaint,
} from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

interface IComplaint {
    id: string;
    trackingCode: string;
}

interface IExtraComplaints {
    first: IComplaint;
    second: IComplaint;
    third: IComplaint;
    fourth: IComplaint;
    fifth: IComplaint;
}

let admin: ITestUser;
let citizen: ITestUser;
let citizen2: ITestUser;
let roadsStaff: ITestUser;
let roadsStaff2: ITestUser;
let wasteStaff: ITestUser;
let staff3: ITestUser;
let staff4: ITestUser;
let staff5: ITestUser;
let roads: { id: string };
let waste: { id: string };
let pothole: { id: string };
let garbage: { id: string };
let bulk: { id: string };
let free: IComplaint;
let paid: IComplaint;
let extra: IExtraComplaints;
const raced: IComplaint[] = [];
let moved: IComplaint;

const assign = (complaintId: string, body: object = {}) => http(admin.token).post(`/complaints/${complaintId}/assign`, body);

const transfer = (complaintId: string, body: object) => http(admin.token).post(`/complaints/${complaintId}/transfer`, body);

const activeLoad = (staffId: string) =>
    prisma.complaint.count({
        where: {
            assignedStaffId: staffId,
            deletedAt: null,
            status: { in: [ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS] },
        },
    });

const countOf = (statuses: number[], status: number) => statuses.filter((value) => value === status).length;

const metadataOf = (log: { metadata: unknown }) => log.metadata as Record<string, unknown>;

beforeAll(async () => {
    await resetDatabase();
    ({ admin, citizen, citizen2, roadsStaff, roadsStaff2, wasteStaff, roads, waste, pothole, garbage, bulk } = await createCity());
    free = await submitComplaint(citizen, pothole.id, { priority: "HIGH" });
    paid = await submitComplaint(citizen, bulk.id, { title: "Old sofa and fridge pickup" });
});

describe("assign", () => {
    it("is allowed only for admins", async () => {
        expect((await http(citizen.token).post(`/complaints/${free.id}/assign`, { staffId: roadsStaff.id })).status).toBe(403);
        expect((await http(roadsStaff.token).post(`/complaints/${free.id}/assign`, { staffId: roadsStaff.id })).status).toBe(403);
    });

    it("refuses a staff id that is not a staff member of the complaint's department", async () => {
        const badId = await assign(free.id, { staffId: "nope" });

        expect(badId.status).toBe(400);
        expect(hasFieldError(badId, "staffId")).toBe(true);

        const cases = [
            { staffId: MISSING_ID, message: "No staff member found with this id" },
            { staffId: citizen2.id, message: "No staff member found with this id" },
            { staffId: wasteStaff.id, message: "This staff member works in another department" },
        ];

        for (const { staffId, message } of cases) {
            const res = await assign(free.id, { staffId });

            expect(res.status, message).toBe(400);
            expect(res.body.errors, message).toEqual([{ field: "staffId", message }]);
        }
    });

    it("refuses an unpaid service request and a missing complaint", async () => {
        expect((await assign(paid.id, { staffId: wasteStaff.id })).status).toBe(409);
        expect((await assign(MISSING_ID, { staffId: roadsStaff.id })).status).toBe(404);
    });

    it("assigns a staff member with the admin's note on the timeline", async () => {
        const res = await assign(free.id, { staffId: roadsStaff.id, note: "Please check today" });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "ASSIGNED", assignedStaff: { id: roadsStaff.id } });
        expect(res.body.data.assignedAt).not.toBeNull();
        expect(res.body.data.updates.at(-1)).toMatchObject({
            fromStatus: "SUBMITTED",
            toStatus: "ASSIGNED",
            note: "Please check today",
            actor: { id: admin.id },
        });
    });

    it("refuses the same staff member twice and locks the citizen's edits", async () => {
        expect((await assign(free.id, { staffId: roadsStaff.id })).status).toBe(409);
        expect((await http(citizen.token).patch(`/complaints/${free.id}`, { title: "Too late to edit this one" })).status).toBe(409);
    });

    it("opens the complaint to the assigned staff member only", async () => {
        const list = await http(roadsStaff.token).get("/complaints");

        expect(list.body.meta.total).toBe(1);
        expect(list.body.data[0].id).toBe(free.id);
        expect((await http(roadsStaff.token).get(`/complaints/${free.id}`)).status).toBe(200);
        expect((await http(roadsStaff2.token).get(`/complaints/${free.id}`)).status).toBe(403);
    });

    it("hands the complaint and its access over on reassignment", async () => {
        const res = await assign(free.id, { staffId: roadsStaff2.id });

        expect(res.status).toBe(200);
        expect(res.body.data.assignedStaff.id).toBe(roadsStaff2.id);
        expect(res.body.data.updates.at(-1)).toMatchObject({ fromStatus: "ASSIGNED", toStatus: "ASSIGNED", note: "Assigned to Staff Two" });
        expect((await http(roadsStaff.token).get(`/complaints/${free.id}`)).status).toBe(403);
        expect((await http(roadsStaff2.token).get(`/complaints/${free.id}`)).status).toBe(200);
    });
});

describe("capacity and automatic assignment (limit 2)", () => {
    beforeAll(async () => {
        const create = (number: number) => submitComplaint(citizen, pothole.id, { title: `Capacity test complaint number ${number}` });

        extra = {
            first: await create(1),
            second: await create(2),
            third: await create(3),
            fourth: await create(4),
            fifth: await create(5),
        };
    });

    it("refuses a staff member who already has the maximum of active complaints", async () => {
        expect((await assign(extra.first.id, { staffId: roadsStaff2.id })).status).toBe(200);

        const full = await assign(extra.second.id, { staffId: roadsStaff2.id });

        expect(full.status).toBe(409);
        expect(full.body.message).toBe("Staff member is at full capacity");
        expect(await activeLoad(roadsStaff2.id)).toBe(2);
    });

    it("picks the staff member with the lowest workload", async () => {
        const second = await assign(extra.second.id);
        const third = await assign(extra.third.id);

        expect(second.status).toBe(200);
        expect(second.body.data.assignedStaff.id).toBe(roadsStaff.id);
        expect(third.status).toBe(200);
        expect(third.body.data.assignedStaff.id).toBe(roadsStaff.id);
    });

    it("answers 409 when every staff member is full", async () => {
        const res = await assign(extra.fourth.id);

        expect(res.status).toBe(409);
        expect(res.body.message).toBe("No staff member is available");
        expect((await prisma.complaint.findUniqueOrThrow({ where: { id: extra.fourth.id } })).status).toBe("SUBMITTED");
    });

    it("refuses a blocked staff member", async () => {
        await prisma.user.update({ where: { id: roadsStaff.id }, data: { status: UserStatus.BLOCKED } });

        try {
            const res = await assign(extra.fourth.id, { staffId: roadsStaff.id });

            expect(res.status).toBe(400);
            expect(res.body.errors).toEqual([{ field: "staffId", message: "This staff member is blocked" }]);
        } finally {
            await prisma.user.update({ where: { id: roadsStaff.id }, data: { status: UserStatus.ACTIVE } });
        }
    });
});

describe("parallel assignments", () => {
    beforeAll(async () => {
        staff3 = await createUser({ role: Role.STAFF, name: "Staff Three", departmentId: roads.id });

        for (let number = 1; number <= 6; number++) {
            raced.push(await submitComplaint(citizen2, pothole.id, { title: `Race condition complaint number ${number}` }));
        }
    });

    it("never give one staff member more than the limit", async () => {
        const results = await Promise.all(raced.map((complaint) => assign(complaint.id, { staffId: staff3.id })));
        const statuses = results.map((res) => res.status);

        expect(countOf(statuses, 200), String(statuses)).toBe(2);
        expect(countOf(statuses, 409), String(statuses)).toBe(4);
        expect(await activeLoad(staff3.id)).toBe(2);
    });

    it("spread automatic assignments over the free places only", async () => {
        staff4 = await createUser({ role: Role.STAFF, name: "Staff Four", departmentId: roads.id });
        staff5 = await createUser({ role: Role.STAFF, name: "Staff Five", departmentId: roads.id });

        const leftOver = await prisma.complaint.findMany({
            where: { id: { in: raced.map((complaint) => complaint.id) }, assignedStaffId: null },
            select: { id: true, trackingCode: true },
        });

        expect(leftOver).toHaveLength(4);

        const waiting = [...leftOver, extra.fourth, extra.fifth];
        const results = await Promise.all(waiting.map((complaint) => assign(complaint.id)));
        const statuses = results.map((res) => res.status);

        expect(countOf(statuses, 200), String(statuses)).toBe(4);
        expect(countOf(statuses, 409), String(statuses)).toBe(2);
        expect(await activeLoad(staff4.id)).toBe(2);
        expect(await activeLoad(staff5.id)).toBe(2);

        const loads = await Promise.all([roadsStaff, roadsStaff2, staff3, staff4, staff5].map((staff) => activeLoad(staff.id)));

        expect(loads).toEqual([2, 2, 2, 2, 2]);
    });
});

describe("transfer", () => {
    beforeAll(async () => {
        moved = await prisma.complaint.findFirstOrThrow({
            where: { assignedStaffId: staff3.id },
            select: { id: true, trackingCode: true },
        });
    });

    it("is allowed only for admins", async () => {
        expect((await http(citizen2.token).post(`/complaints/${moved.id}/transfer`, { departmentId: waste.id })).status).toBe(403);
    });

    it("refuses the same department and an unknown one", async () => {
        const unknown = await transfer(moved.id, { departmentId: MISSING_ID });

        expect((await transfer(moved.id, { departmentId: roads.id })).status).toBe(409);
        expect(unknown.status).toBe(400);
        expect(hasFieldError(unknown, "departmentId")).toBe(true);
    });

    it("moves the complaint back to the queue of the new department", async () => {
        const res = await transfer(moved.id, { departmentId: waste.id, note: "This is a waste issue" });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            status: "SUBMITTED",
            department: { id: waste.id },
            assignedStaff: null,
            assignedAt: null,
        });
        expect(res.body.data.updates.at(-1)).toMatchObject({
            fromStatus: "ASSIGNED",
            toStatus: "SUBMITTED",
            note: "Transferred to Waste Management: This is a waste issue",
        });
        expect(await activeLoad(staff3.id)).toBe(1);
    });

    it("takes the complaint away from the old staff member and department", async () => {
        const res = await assign(moved.id, { staffId: staff3.id });

        expect((await http(staff3.token).get(`/complaints/${moved.id}`)).status).toBe(403);
        expect(res.status).toBe(400);
        expect(res.body.errors).toEqual([{ field: "staffId", message: "This staff member works in another department" }]);
    });

    it("is assigned automatically inside the new department", async () => {
        const res = await assign(moved.id);

        expect(res.status).toBe(200);
        expect(res.body.data.assignedStaff.id).toBe(wasteStaff.id);
    });

    it("refuses a closed complaint", async () => {
        const closed = await submitComplaint(citizen, garbage.id, { title: "Garbage left on the street corner" });

        await resolveComplaint(admin, wasteStaff, closed.id);
        await moveStatus(admin, closed.id, "CLOSED");

        expect((await transfer(closed.id, { departmentId: roads.id })).status).toBe(409);
    });
});

describe("audit trail", () => {
    it("records manual, automatic and refused assignments correctly", async () => {
        const logs = await prisma.auditLog.findMany({ where: { action: "COMPLAINT_ASSIGNED" }, orderBy: { createdAt: "asc" } });
        const forComplaint = (complaintId: string) => logs.filter((log) => log.entityId === complaintId).map(metadataOf);

        expect(logs.every((log) => log.actorId === admin.id)).toBe(true);
        expect(forComplaint(free.id)).toEqual([
            expect.objectContaining({ staffId: roadsStaff.id, previousStaffId: null, automatic: false }),
            expect.objectContaining({ staffId: roadsStaff2.id, previousStaffId: roadsStaff.id, automatic: false }),
        ]);
        expect(forComplaint(extra.second.id)).toEqual([expect.objectContaining({ staffId: roadsStaff.id, automatic: true })]);
        expect(logs.filter((log) => metadataOf(log).staffId === staff3.id)).toHaveLength(2);
        expect(forComplaint(moved.id).at(-1)).toMatchObject({ staffId: wasteStaff.id, automatic: true });
    });

    it("records the transfer with both departments and the previous staff member", async () => {
        const logs = await prisma.auditLog.findMany({ where: { action: "COMPLAINT_TRANSFERRED" } });

        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({
            actorId: admin.id,
            entityId: moved.id,
            metadata: { fromDepartmentId: roads.id, toDepartmentId: waste.id, previousStaffId: staff3.id },
        });
    });
});

describe("reassignment next to an automatic assignment", () => {
    let lawn: { id: string };
    let gardenerOne: ITestUser;
    let gardenerTwo: ITestUser;

    beforeAll(async () => {
        const parks = await createDepartment("Parks & Gardens");

        lawn = await createCategory(parks.id, { name: "Overgrown lawn", slaHours: 48 });
        gardenerOne = await createUser({ role: Role.STAFF, name: "Gardener One", departmentId: parks.id });
        gardenerTwo = await createUser({ role: Role.STAFF, name: "Gardener Two", departmentId: parks.id });
    });

    it("never deadlocks, whichever staff member has the lower id", async () => {
        for (const [from, to] of [
            [gardenerOne, gardenerTwo],
            [gardenerTwo, gardenerOne],
            [gardenerOne, gardenerTwo],
            [gardenerTwo, gardenerOne],
        ] as const) {
            const moving = await submitComplaint(citizen, lawn.id, { title: "The lawn in the park needs mowing" });
            const waiting = await submitComplaint(citizen2, lawn.id, { title: "Grass is knee high near the pond" });

            expect((await assign(moving.id, { staffId: from.id })).status).toBe(200);

            const results = await Promise.all([assign(moving.id, { staffId: to.id }), assign(waiting.id)]);

            expect(results.map((res) => res.status)).toEqual([200, 200]);
            await prisma.complaint.updateMany({ where: { id: { in: [moving.id, waiting.id] } }, data: { status: ComplaintStatus.CLOSED } });
        }
    });
});
