import { beforeAll, describe, expect, it } from "vitest";
import { prisma, resetDatabase } from "../helpers/db";
import { complaintBody, createCity, type ITestUser, MISSING_ID, submitComplaint } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

interface IComplaint {
    id: string;
    trackingCode: string;
}

const HOUR = 60 * 60 * 1000;

let admin: ITestUser;
let citizen: ITestUser;
let citizen2: ITestUser;
let roadsStaff: ITestUser;
let roads: { id: string };
let waste: { id: string };
let pothole: { id: string };
let light: { id: string };
let bulk: { id: string };
let free: IComplaint;
let paid: IComplaint;
let lightOne: IComplaint;
let other: IComplaint;
let toCancel: IComplaint;

const ids = (items: { id: string }[]) => items.map((item) => item.id);

const adminList = async (query: string) => {
    const res = await http(admin.token).get(`/complaints?${query}`);

    expect(res.status, query).toBe(200);

    return res.body;
};

beforeAll(async () => {
    await resetDatabase();
    ({ admin, citizen, citizen2, roadsStaff, roads, waste, pothole, light, bulk } = await createCity());
});

describe("create", () => {
    it("is open only to citizens", async () => {
        const body = complaintBody(pothole.id);

        expect((await http().post("/complaints", body)).status).toBe(401);
        expect((await http(roadsStaff.token).post("/complaints", body)).status).toBe(403);
        expect((await http(admin.token).post("/complaints", body)).status).toBe(403);
    });

    it("validates the fields", async () => {
        const res = await http(citizen.token).post("/complaints", {
            title: "Hi",
            description: "short",
            categoryId: "x",
            address: "a",
            area: "",
            priority: "NOW",
            latitude: 23.8,
        });

        expect(res.status).toBe(400);
        for (const field of ["title", "description", "categoryId", "address", "area", "priority"]) {
            expect(hasFieldError(res, field), field).toBe(true);
        }
    });

    it("needs both coordinates inside their ranges", async () => {
        const latitudeOnly = await http(citizen.token).post("/complaints", complaintBody(pothole.id, { latitude: 23.8 }));
        const outOfRange = await http(citizen.token).post("/complaints", complaintBody(pothole.id, { latitude: 123, longitude: 90 }));

        expect(latitudeOnly.status).toBe(400);
        expect(hasFieldError(latitudeOnly, "longitude")).toBe(true);
        expect(outOfRange.status).toBe(400);
        expect(hasFieldError(outOfRange, "latitude")).toBe(true);
    });

    it("refuses an unknown category", async () => {
        const res = await http(citizen.token).post("/complaints", complaintBody(MISSING_ID));

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "categoryId")).toBe(true);
    });

    it("submits a free complaint to the department of its category with an SLA due date", async () => {
        const res = await http(citizen.token).post(
            "/complaints",
            complaintBody(pothole.id, { latitude: 23.8, longitude: 90.36, priority: "HIGH" })
        );

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
            type: "COMPLAINT",
            status: "SUBMITTED",
            paymentStatus: "NOT_REQUIRED",
            priority: "HIGH",
            latitude: 23.8,
            longitude: 90.36,
            isOverdue: false,
            department: { id: roads.id },
            citizen: { id: citizen.id },
            assignedStaff: null,
        });
        expect(Number(res.body.data.fee)).toBe(0);
        expect(res.body.data.trackingCode).toMatch(/^CC-\d{6}-[A-Z0-9]{6}$/);
        expect(Date.parse(res.body.data.dueAt) - Date.parse(res.body.data.submittedAt)).toBe(48 * HOUR);
        expect(res.body.data.updates).toHaveLength(1);
        expect(res.body.data.updates[0]).toMatchObject({
            fromStatus: null,
            toStatus: "SUBMITTED",
            note: "Complaint submitted",
            actor: { id: citizen.id },
        });
        free = res.body.data;
    });

    it("keeps a paid service request waiting for its fee", async () => {
        const res = await http(citizen.token).post("/complaints", complaintBody(bulk.id, { title: "Old sofa and fridge pickup" }));

        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Service request created. Pay the service fee to submit it.");
        expect(res.body.data).toMatchObject({
            type: "SERVICE",
            status: "PENDING_PAYMENT",
            paymentStatus: "UNPAID",
            submittedAt: null,
            dueAt: null,
            department: { id: waste.id },
        });
        expect(Number(res.body.data.fee)).toBe(15);
        expect(res.body.data.updates[0]).toMatchObject({ toStatus: "PENDING_PAYMENT" });
        paid = res.body.data;
    });

    it("refuses an inactive category and accepts it again once it is active", async () => {
        expect((await http(admin.token).patch(`/categories/${light.id}`, { isActive: false })).status).toBe(200);
        expect((await http(citizen.token).post("/complaints", complaintBody(light.id))).status).toBe(400);
        expect((await http(admin.token).patch(`/categories/${light.id}`, { isActive: true })).status).toBe(200);

        const created = await submitComplaint(citizen, light.id, {
            title: "Street light broken for a week",
            area: "Uttara",
            priority: "URGENT",
        });

        expect(Date.parse(created.dueAt) - Date.parse(created.submittedAt)).toBe(24 * HOUR);
        lightOne = created;
    });
});

describe("list", () => {
    beforeAll(async () => {
        other = await submitComplaint(citizen2, pothole.id, {
            title: "Road surface damaged after rain",
            area: "Dhanmondi",
            priority: "LOW",
        });
    });

    it("needs a login", async () => {
        expect((await http().get("/complaints")).status).toBe(401);
    });

    it("shows citizens only their own complaints", async () => {
        const own = await http(citizen.token).get("/complaints");
        const widened = await http(citizen.token).get(`/complaints?citizenId=${citizen2.id}`);
        const second = await http(citizen2.token).get("/complaints");

        expect(own.body.meta.total).toBe(3);
        expect(own.body.data.every((item: { citizen: { id: string } }) => item.citizen.id === citizen.id)).toBe(true);
        expect(widened.body.meta.total).toBe(3);
        expect(ids(second.body.data)).toEqual([other.id]);
    });

    it("shows staff only their assigned complaints and admins everything", async () => {
        expect((await http(roadsStaff.token).get("/complaints")).body.meta.total).toBe(0);
        expect((await adminList("")).meta.total).toBe(4);
    });

    it("paginates without overlap", async () => {
        const first = await adminList("limit=3&page=1");
        const second = await adminList("limit=3&page=2");

        expect(first.meta).toEqual({ page: 1, limit: 3, total: 4, totalPages: 2 });
        expect(first.data).toHaveLength(3);
        expect(second.meta.page).toBe(2);
        expect(second.data).toHaveLength(1);
        expect(new Set([...ids(first.data), ...ids(second.data)]).size).toBe(4);
    });

    it("filters by status, type, payment status, department, category, priority, area and citizen", async () => {
        expect(ids((await adminList("status=PENDING_PAYMENT")).data)).toEqual([paid.id]);
        expect(ids((await adminList("type=SERVICE")).data)).toEqual([paid.id]);
        expect(ids((await adminList("paymentStatus=UNPAID")).data)).toEqual([paid.id]);
        expect((await adminList(`departmentId=${roads.id}`)).meta.total).toBe(3);
        expect(ids((await adminList(`categoryId=${light.id}`)).data)).toEqual([lightOne.id]);
        expect(ids((await adminList("priority=URGENT")).data)).toEqual([lightOne.id]);
        expect(ids((await adminList("area=mirp&sortOrder=asc")).data)).toEqual([free.id, paid.id]);
        expect(ids((await adminList(`citizenId=${citizen2.id}`)).data)).toEqual([other.id]);
        expect((await adminList("unassigned=true")).meta.total).toBe(4);
    });

    it("searches the title and the tracking code in any letter case", async () => {
        expect(ids((await adminList(`searchTerm=${encodeURIComponent("STREET LIGHT")}`)).data)).toEqual([lightOne.id]);
        expect(ids((await adminList(`searchTerm=${free.trackingCode.toLowerCase()}`)).data)).toEqual([free.id]);
    });

    it("sorts by priority and by creation time", async () => {
        expect(ids((await adminList("sortBy=priority&sortOrder=desc")).data)).toEqual([lightOne.id, free.id, paid.id, other.id]);
        expect(ids((await adminList("sortBy=createdAt&sortOrder=asc")).data)).toEqual([free.id, paid.id, lightOne.id, other.id]);
    });

    it("filters by creation date", async () => {
        const yesterday = new Date(Date.now() - 24 * HOUR).toISOString();
        const tomorrow = new Date(Date.now() + 24 * HOUR).toISOString();

        expect((await adminList(`from=${tomorrow}`)).meta.total).toBe(0);
        expect((await adminList(`from=${yesterday}&to=${tomorrow}`)).meta.total).toBe(4);
    });

    it("refuses bad query values", async () => {
        const tomorrow = new Date(Date.now() + 24 * HOUR).toISOString();
        const queries = [
            "limit=1000",
            "page=0",
            "sortBy=name",
            "status=DONE",
            "from=not-a-date",
            `from=${tomorrow}&to=2020-01-01`,
            "overdue=yes",
            "categoryId=5",
        ];

        for (const query of queries) {
            expect((await http(admin.token).get(`/complaints?${query}`)).status, query).toBe(400);
        }
    });

    it("finds and flags complaints that passed their due date", async () => {
        await prisma.complaint.update({ where: { id: other.id }, data: { dueAt: new Date(Date.now() - 2 * HOUR) } });

        const overdue = await adminList("overdue=true");
        const onTime = await adminList("overdue=false");

        expect(ids(overdue.data)).toEqual([other.id]);
        expect(overdue.data[0].isOverdue).toBe(true);
        expect(onTime.meta.total).toBe(3);
        expect(onTime.data.every((item: { isOverdue: boolean }) => item.isOverdue === false)).toBe(true);
    });
});

describe("details and tracking", () => {
    it("opens an unassigned complaint only for its citizen and admins", async () => {
        expect((await http(citizen.token).get(`/complaints/${free.id}`)).status).toBe(200);
        expect((await http(admin.token).get(`/complaints/${free.id}`)).status).toBe(200);
        expect((await http(citizen2.token).get(`/complaints/${free.id}`)).status).toBe(403);
        expect((await http(roadsStaff.token).get(`/complaints/${free.id}`)).status).toBe(403);
    });

    it("answers 404 for a missing complaint and 400 for a bad id", async () => {
        expect((await http(admin.token).get(`/complaints/${MISSING_ID}`)).status).toBe(404);
        expect((await http(admin.token).get("/complaints/abc")).status).toBe(400);
    });

    it("tracks a complaint publicly by its code without personal data", async () => {
        const res = await http().get(`/complaints/track/${free.trackingCode.toLowerCase()}`);
        const text = JSON.stringify(res.body.data);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            trackingCode: free.trackingCode,
            status: "SUBMITTED",
            area: "Mirpur",
            isOverdue: false,
            category: { name: "Pothole" },
            department: { name: "Roads & Transport" },
            id: free.id,
            isPublic: true,
            latitude: 23.8,
            longitude: 90.36,
            supportCount: 0,
        });
        expect(res.body.data.updates).toEqual([{ fromStatus: null, toStatus: "SUBMITTED", createdAt: expect.any(String) }]);
        for (const field of ["citizen", "citizenId", "assignedStaff", "description", "address", "attachments", "payments"]) {
            expect(res.body.data, field).not.toHaveProperty(field);
        }
        expect(text).not.toContain(citizen.email);
        expect(text).not.toContain("Road 7");
        expect(text).not.toContain("causing accidents");
    });

    it("refuses a malformed tracking code and answers 404 for an unknown one", async () => {
        expect((await http().get("/complaints/track/hello")).status).toBe(400);
        expect((await http().get("/complaints/track/CC-261013-ZZZZZZ")).status).toBe(404);
    });
});

describe("update", () => {
    it("needs at least one field", async () => {
        expect((await http(citizen.token).patch(`/complaints/${free.id}`, {})).status).toBe(400);
    });

    it("is refused for other citizens and for staff", async () => {
        expect((await http(citizen2.token).patch(`/complaints/${free.id}`, { title: "Changed by someone else" })).status).toBe(403);
        expect((await http(roadsStaff.token).patch(`/complaints/${free.id}`, { priority: "LOW" })).status).toBe(403);
    });

    it("saves the changes of the citizen who owns the complaint", async () => {
        const res = await http(citizen.token).patch(`/complaints/${free.id}`, {
            title: "Deep pothole near the school main gate",
            area: "Mirpur 10",
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ title: "Deep pothole near the school main gate", area: "Mirpur 10" });
        expect(await prisma.complaint.findUniqueOrThrow({ where: { id: free.id }, select: { title: true, area: true } })).toEqual({
            title: "Deep pothole near the school main gate",
            area: "Mirpur 10",
        });
    });

    it("lets an admin change only the priority and notes it on the timeline", async () => {
        const otherField = await http(admin.token).patch(`/complaints/${free.id}`, { title: "Admin title here" });

        expect(otherField.status).toBe(400);
        expect(hasFieldError(otherField, "title")).toBe(true);

        const res = await http(admin.token).patch(`/complaints/${free.id}`, { priority: "URGENT" });

        expect(res.status).toBe(200);
        expect(res.body.data.priority).toBe("URGENT");
        expect(res.body.data.updates.at(-1)).toMatchObject({
            fromStatus: "SUBMITTED",
            toStatus: "SUBMITTED",
            note: "Priority changed from HIGH to URGENT",
            actor: { id: admin.id },
        });
    });
});

describe("soft delete", () => {
    beforeAll(async () => {
        toCancel = await submitComplaint(citizen2, pothole.id, { title: "Complaint that will be cancelled" });

        const cancelled = await http(citizen2.token).post(`/complaints/${toCancel.id}/cancel`, {
            reason: "It was fixed by the neighbours",
        });

        expect(cancelled.status).toBe(200);
    });

    it("keeps an open complaint from being removed by its citizen", async () => {
        expect((await http(citizen2.token).delete(`/complaints/${other.id}`)).status).toBe(409);
    });

    it("lets only the citizen who owns a finished complaint remove it", async () => {
        expect((await http(citizen.token).delete(`/complaints/${toCancel.id}`)).status).toBe(403);
        expect((await http(roadsStaff.token).delete(`/complaints/${toCancel.id}`)).status).toBe(403);
        expect((await http(citizen2.token).delete(`/complaints/${toCancel.id}`)).status).toBe(200);
    });

    it("keeps the row but hides it everywhere", async () => {
        const row = await prisma.complaint.findUniqueOrThrow({ where: { id: toCancel.id } });

        expect(row.deletedAt).not.toBeNull();
        expect((await http(citizen2.token).get(`/complaints/${toCancel.id}`)).status).toBe(404);
        expect((await http().get(`/complaints/track/${toCancel.trackingCode}`)).status).toBe(404);
        expect((await http(citizen2.token).get("/complaints?status=CANCELLED")).body.meta.total).toBe(0);
        expect((await http(citizen2.token).delete(`/complaints/${toCancel.id}`)).status).toBe(404);
    });

    it("lets an admin remove an open complaint", async () => {
        expect((await http(admin.token).delete(`/complaints/${other.id}`)).status).toBe(200);
        expect(ids((await adminList("")).data)).not.toContain(other.id);
        expect((await http(admin.token).post(`/complaints/${other.id}/assign`, {})).status).toBe(404);
    });
});

describe("catalog guards", () => {
    it("keeps a category and a department that open complaints still use", async () => {
        const category = await http(admin.token).delete(`/categories/${pothole.id}`);

        expect(category.status).toBe(409);
        expect(category.body.errors[0].message).toContain("open complaints use this category");
        expect((await http(admin.token).delete(`/departments/${roads.id}`)).status).toBe(409);
    });
});

describe("audit trail", () => {
    it("records who created, edited and removed each complaint", async () => {
        const logs = await prisma.auditLog.findMany({ where: { entityType: "COMPLAINT" }, orderBy: { createdAt: "asc" } });
        const actorsOf = (action: string, entityId: string) =>
            logs.filter((log) => log.action === action && log.entityId === entityId).map((log) => log.actorId);

        expect(logs.filter((log) => log.action === "COMPLAINT_CREATED")).toHaveLength(5);
        expect(actorsOf("COMPLAINT_CREATED", other.id)).toEqual([citizen2.id]);
        expect(actorsOf("COMPLAINT_UPDATED", free.id)).toEqual([citizen.id, admin.id]);
        expect(actorsOf("COMPLAINT_DELETED", toCancel.id)).toEqual([citizen2.id]);
        expect(actorsOf("COMPLAINT_DELETED", other.id)).toEqual([admin.id]);
    });
});
