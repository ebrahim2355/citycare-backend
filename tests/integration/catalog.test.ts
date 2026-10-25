import { beforeAll, describe, expect, it } from "vitest";
import { Role } from "../../src/generated/prisma/client";
import { prisma, resetDatabase } from "../helpers/db";
import { createUser, type ITestUser, MISSING_ID } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

let admin: ITestUser;
let citizen: ITestUser;
let roads: { id: string };
let waste: { id: string };
let pothole: { id: string };
let bulk: { id: string };

beforeAll(async () => {
    await resetDatabase();
    admin = await createUser({ role: Role.ADMIN, name: "City Admin" });
    citizen = await createUser({ name: "Citizen One" });
});

describe("departments", () => {
    it("can be created only by an admin", async () => {
        expect((await http().post("/departments", { name: "Roads" })).status).toBe(401);
        expect((await http(citizen.token).post("/departments", { name: "Roads" })).status).toBe(403);
    });

    it("validates the fields", async () => {
        const res = await http(admin.token).post("/departments", { name: "R", contactEmail: "nope" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "name")).toBe(true);
        expect(hasFieldError(res, "contactEmail")).toBe(true);
    });

    it("creates a department and stores the contact email in lower case", async () => {
        const res = await http(admin.token).post("/departments", {
            name: "Roads & Transport",
            description: "Roads, footpaths and traffic signals",
            contactEmail: " Roads@City.gov ",
        });

        expect(res.status).toBe(201);
        expect(res.body.data.contactEmail).toBe("roads@city.gov");
        roads = res.body.data;
        waste = (await http(admin.token).post("/departments", { name: "Waste Management" })).body.data;
    });

    it("refuses a duplicate name in any letter case", async () => {
        expect((await http(admin.token).post("/departments", { name: "roads & transport" })).status).toBe(409);
    });

    it("lists departments for everyone, sorted by name", async () => {
        const res = await http().get("/departments");

        expect(res.status).toBe(200);
        expect(res.body.data.map((item: { name: string }) => item.name)).toEqual(["Roads & Transport", "Waste Management"]);
    });

    it("shows one department and answers 404 or 400 for wrong ids", async () => {
        expect((await http().get(`/departments/${roads.id}`)).status).toBe(200);
        expect((await http().get(`/departments/${MISSING_ID}`)).status).toBe(404);
        expect((await http().get("/departments/not-a-uuid")).status).toBe(400);
    });

    it("updates a department", async () => {
        expect((await http(admin.token).patch(`/departments/${roads.id}`, {})).status).toBe(400);
        expect((await http(admin.token).patch(`/departments/${roads.id}`, { name: "Waste Management" })).status).toBe(409);
        expect((await http(citizen.token).patch(`/departments/${roads.id}`, { description: "x" })).status).toBe(403);

        const res = await http(admin.token).patch(`/departments/${roads.id}`, { description: "Roads and traffic" });

        expect(res.status).toBe(200);
        expect(res.body.data.description).toBe("Roads and traffic");
    });
});

describe("categories", () => {
    it("can be created only by an admin with valid fields", async () => {
        expect((await http(citizen.token).post("/categories", { name: "Pothole", departmentId: roads.id })).status).toBe(403);

        const res = await http(admin.token).post("/categories", { name: "P", type: "OTHER", fee: -1, slaHours: 0, departmentId: "x" });

        expect(res.status).toBe(400);
        for (const field of ["name", "type", "fee", "slaHours", "departmentId"]) {
            expect(hasFieldError(res, field), field).toBe(true);
        }
    });

    it("refuses a fee on a free complaint category and an unknown department", async () => {
        const withFee = await http(admin.token).post("/categories", {
            name: "Pothole",
            type: "COMPLAINT",
            fee: 10,
            departmentId: roads.id,
        });
        const unknown = await http(admin.token).post("/categories", { name: "Pothole", departmentId: MISSING_ID });

        expect(withFee.status).toBe(400);
        expect(unknown.status).toBe(400);
    });

    it("creates a free complaint category with defaults", async () => {
        const res = await http(admin.token).post("/categories", {
            name: "Pothole",
            description: "Holes and broken road surface",
            slaHours: 48,
            departmentId: roads.id,
        });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ type: "COMPLAINT", department: { id: roads.id } });
        expect(Number(res.body.data.fee)).toBe(0);
        pothole = res.body.data;
    });

    it("creates a paid service category", async () => {
        const res = await http(admin.token).post("/categories", {
            name: "Bulk waste pickup",
            type: "SERVICE",
            fee: 15.5,
            slaHours: 72,
            departmentId: waste.id,
        });

        expect(res.status).toBe(201);
        expect(Number(res.body.data.fee)).toBe(15.5);
        bulk = res.body.data;
        expect((await http(admin.token).post("/categories", { name: "pothole", departmentId: roads.id })).status).toBe(409);
    });

    it("lists, filters and searches categories", async () => {
        expect((await http().get("/categories")).body.data).toHaveLength(2);
        expect((await http().get("/categories?type=SERVICE")).body.data.map((item: { name: string }) => item.name)).toEqual([
            "Bulk waste pickup",
        ]);
        expect((await http().get(`/categories?departmentId=${roads.id}`)).body.data[0].name).toBe("Pothole");
        expect((await http().get("/categories?searchTerm=WASTE")).body.data).toHaveLength(1);
        expect((await http().get("/categories?type=WRONG")).status).toBe(400);
    });

    it("keeps the fee rules on update", async () => {
        expect((await http(admin.token).patch(`/categories/${pothole.id}`, { fee: 5 })).status).toBe(400);
        expect((await http(admin.token).patch(`/categories/${bulk.id}`, { type: "COMPLAINT" })).status).toBe(400);

        const res = await http(admin.token).patch(`/categories/${bulk.id}`, { isActive: false, fee: 20 });

        expect(res.status).toBe(200);
        expect(Number(res.body.data.fee)).toBe(20);
        expect(res.body.data.isActive).toBe(false);
    });

    it("hides inactive categories from everyone except admins", async () => {
        expect((await http().get("/categories")).body.data).toHaveLength(1);
        expect((await http().get("/categories?includeInactive=true")).body.data).toHaveLength(1);
        expect((await http(citizen.token).get("/categories?includeInactive=true")).body.data).toHaveLength(1);
        expect((await http(admin.token).get("/categories?includeInactive=true")).body.data).toHaveLength(2);
    });

    it("rejects a broken token even on a public route", async () => {
        expect((await http("broken-token").get("/categories")).status).toBe(401);
    });
});

describe("soft delete", () => {
    it("keeps a department that still has categories", async () => {
        expect((await http(admin.token).delete(`/departments/${waste.id}`)).status).toBe(409);
    });

    it("soft deletes a category", async () => {
        expect((await http(citizen.token).delete(`/categories/${bulk.id}`)).status).toBe(403);
        expect((await http(admin.token).delete(`/categories/${bulk.id}`)).status).toBe(200);

        const row = await prisma.category.findUniqueOrThrow({ where: { id: bulk.id } });

        expect(row.deletedAt).not.toBeNull();
        expect((await http().get(`/categories/${bulk.id}`)).status).toBe(404);
        expect((await http(admin.token).delete(`/categories/${bulk.id}`)).status).toBe(404);
    });

    it("soft deletes an empty department and keeps its name reserved", async () => {
        expect((await http(admin.token).delete(`/departments/${waste.id}`)).status).toBe(200);
        expect((await http().get("/departments")).body.data).toHaveLength(1);
        expect((await http(admin.token).post("/departments", { name: "Waste Management" })).status).toBe(409);
    });
});

describe("audit trail", () => {
    it("records every catalog change with its actor", async () => {
        const logs = await prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
        const actions = new Set(logs.map((log) => log.action));

        for (const action of [
            "DEPARTMENT_CREATED",
            "DEPARTMENT_UPDATED",
            "CATEGORY_CREATED",
            "CATEGORY_UPDATED",
            "CATEGORY_DELETED",
            "DEPARTMENT_DELETED",
        ]) {
            expect(actions.has(action), action).toBe(true);
        }

        expect(logs.every((log) => log.actorId === admin.id)).toBe(true);
    });
});
