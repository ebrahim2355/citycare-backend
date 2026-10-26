import { beforeAll, describe, expect, it } from "vitest";
import { Role } from "../../src/generated/prisma/client";
import { mailTest } from "../fakes/mailer";
import { prisma, resetDatabase } from "../helpers/db";
import {
    assignTo,
    createCategory,
    createDepartment,
    createUser,
    type ITestUser,
    login,
    MISSING_ID,
    submitComplaint,
    TEST_PASSWORD,
} from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

let admin: ITestUser;
let staff: ITestUser;
let karim: ITestUser;
let rahim: ITestUser;
let salma: ITestUser;
let roads: { id: string };
let waste: { id: string };
let complaint: { id: string };
let newStaff: { id: string };

const loginStatus = async (user: ITestUser) => (await http().post("/auth/login", { email: user.email, password: user.password })).status;

beforeAll(async () => {
    await resetDatabase();
    roads = await createDepartment("Roads & Transport");
    waste = await createDepartment("Waste Management");

    const pothole = await createCategory(roads.id, { name: "Pothole" });

    admin = await createUser({ role: Role.ADMIN, name: "City Admin", email: "admin@test.com" });
    staff = await createUser({ role: Role.STAFF, name: "Staff One", email: "s1@test.com", departmentId: roads.id });
    karim = await createUser({ name: "Karim Citizen", email: "karim@test.com" });
    rahim = await createUser({ name: "Rahim Citizen", email: "rahim@test.com" });
    salma = await createUser({ name: "Salma Citizen", email: "salma@test.com" });
    complaint = await submitComplaint(karim, pothole.id);
});

describe("access", () => {
    it("every user route needs an admin token", async () => {
        const routes = [
            ["get", "/admin/users"],
            ["post", "/admin/users"],
            ["patch", `/admin/users/${rahim.id}/role`],
            ["patch", `/admin/users/${rahim.id}/status`],
            ["delete", `/admin/users/${rahim.id}`],
            ["get", "/admin/staff-workload"],
        ] as const;
        const callers = [
            { label: "a guest", token: undefined, status: 401 },
            { label: "a citizen", token: karim.token, status: 403 },
            { label: "staff", token: staff.token, status: 403 },
        ];

        for (const [method, path] of routes) {
            for (const caller of callers) {
                const client = http(caller.token);
                const res = method === "get" || method === "delete" ? await client[method](path) : await client[method](path, {});

                expect(res.status, `${method.toUpperCase()} ${path} as ${caller.label}`).toBe(caller.status);
            }
        }
    });
});

describe("list users", () => {
    it("lists every user without secrets", async () => {
        const res = await http(admin.token).get("/admin/users");

        expect(res.status).toBe(200);
        expect(res.body.meta.total).toBe(5);
        expect(res.text).not.toContain("password");
        expect(res.text).not.toContain("tokenHash");
    });

    it("filters, searches and sorts", async () => {
        const citizens = await http(admin.token).get("/admin/users?role=CITIZEN&limit=2");

        expect(citizens.body.meta).toMatchObject({ total: 3, totalPages: 2 });
        expect(citizens.body.data).toHaveLength(2);

        const byName = await http(admin.token).get("/admin/users?searchTerm=RAHIM");

        expect(byName.body.meta.total).toBe(1);
        expect(byName.body.data[0].email).toBe("rahim@test.com");
        expect((await http(admin.token).get("/admin/users?searchTerm=s1@test")).body.meta.total).toBe(1);

        const roadsTeam = await http(admin.token).get(`/admin/users?departmentId=${roads.id}`);

        expect(roadsTeam.body.meta.total).toBe(1);
        expect(roadsTeam.body.data[0].department.name).toBe("Roads & Transport");
        expect((await http(admin.token).get("/admin/users?sortBy=name&sortOrder=asc")).body.data[0].name).toBe("City Admin");
        expect((await http(admin.token).get("/admin/users?role=BOSS")).status).toBe(400);
    });
});

describe("create user", () => {
    const staffBody = { name: "New Staff", email: "new.staff@test.com", password: "staff12345", role: "STAFF" };

    it("validates the fields", async () => {
        const res = await http(admin.token).post("/admin/users", { name: "X", email: "bad", password: "123", role: "CITIZEN" });

        expect(res.status).toBe(400);
        for (const field of ["name", "email", "password", "role"]) {
            expect(hasFieldError(res, field), field).toBe(true);
        }
    });

    it("needs a real department for a staff member and a free email", async () => {
        const noDepartment = await http(admin.token).post("/admin/users", staffBody);
        const unknownDepartment = await http(admin.token).post("/admin/users", { ...staffBody, departmentId: MISSING_ID });

        expect(noDepartment.status).toBe(400);
        expect(hasFieldError(noDepartment, "departmentId")).toBe(true);
        expect(unknownDepartment.status).toBe(400);
        expect(hasFieldError(unknownDepartment, "departmentId")).toBe(true);
        expect(
            (await http(admin.token).post("/admin/users", { ...staffBody, email: "karim@test.com", departmentId: waste.id })).status
        ).toBe(409);
    });

    it("creates a staff member who can log in", async () => {
        const res = await http(admin.token).post("/admin/users", { ...staffBody, email: "New.Staff@test.com", departmentId: waste.id });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ role: "STAFF", email: "new.staff@test.com", department: { id: waste.id } });
        newStaff = res.body.data;
        expect(mailTest.sentTo("new.staff@test.com").map((email) => email.subject)).toEqual(["Your CityCare account was created"]);

        const session = await http().post("/auth/login", { email: "new.staff@test.com", password: "staff12345" });

        expect(session.status).toBe(200);
        expect(session.body.data.user.role).toBe("STAFF");
    });

    it("creates an admin without a department", async () => {
        const res = await http(admin.token).post("/admin/users", {
            name: "Second Admin",
            email: "admin2@test.com",
            password: "admin12345",
            role: "ADMIN",
            departmentId: waste.id,
        });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ role: "ADMIN", departmentId: null });
    });
});

describe("role", () => {
    it("refuses own role, unknown users and bad roles", async () => {
        expect((await http(admin.token).patch(`/admin/users/${admin.id}/role`, { role: "CITIZEN" })).status).toBe(400);
        expect((await http(admin.token).patch(`/admin/users/${MISSING_ID}/role`, { role: "CITIZEN" })).status).toBe(404);
        expect((await http(admin.token).patch(`/admin/users/${rahim.id}/role`, { role: "MAYOR" })).status).toBe(400);

        const noDepartment = await http(admin.token).patch(`/admin/users/${rahim.id}/role`, { role: "STAFF" });

        expect(noDepartment.status).toBe(400);
        expect(hasFieldError(noDepartment, "departmentId")).toBe(true);
    });

    it("promotes a citizen to staff and the old token follows the new role", async () => {
        const res = await http(admin.token).patch(`/admin/users/${rahim.id}/role`, { role: "STAFF", departmentId: roads.id });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ role: "STAFF", department: { id: roads.id } });

        const work = await http(rahim.token).get("/complaints");

        expect(work.status).toBe(200);
        expect(work.body.meta.total).toBe(0);
        expect((await http(rahim.token).get("/stats/me")).body.data.role).toBe("STAFF");
        expect((await http(admin.token).patch(`/admin/users/${rahim.id}/role`, { role: "STAFF", departmentId: roads.id })).status).toBe(
            409
        );
    });

    it("keeps a staff member with active complaints where they are", async () => {
        await assignTo(admin, complaint.id, rahim.id);

        expect((await http(admin.token).patch(`/admin/users/${rahim.id}/role`, { role: "CITIZEN" })).status).toBe(409);
        expect((await http(admin.token).patch(`/admin/users/${rahim.id}/role`, { role: "STAFF", departmentId: waste.id })).status).toBe(
            409
        );
        expect((await http(admin.token).patch(`/admin/users/${rahim.id}/status`, { status: "BLOCKED" })).status).toBe(409);
        expect((await http(admin.token).delete(`/admin/users/${rahim.id}`)).status).toBe(409);
    });

    it("demotes after the work is handed over and clears the department", async () => {
        await assignTo(admin, complaint.id, staff.id);

        const res = await http(admin.token).patch(`/admin/users/${rahim.id}/role`, { role: "CITIZEN", departmentId: roads.id });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ role: "CITIZEN", departmentId: null });
    });
});

describe("status", () => {
    it("refuses own account and unknown statuses", async () => {
        expect((await http(admin.token).patch(`/admin/users/${admin.id}/status`, { status: "BLOCKED" })).status).toBe(400);
        expect((await http(admin.token).patch(`/admin/users/${salma.id}/status`, { status: "GONE" })).status).toBe(400);
    });

    it("blocks a user and ends every session", async () => {
        const session = await login(salma.email);
        const res = await http(admin.token).patch(`/admin/users/${salma.id}/status`, { status: "BLOCKED", reason: "Spam complaints" });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("BLOCKED");
        expect((await http(salma.token).get("/users/me")).status).toBe(403);
        expect([401, 403]).toContain((await http().post("/auth/refresh-token", { refreshToken: session.refreshToken })).status);
        expect(await prisma.refreshToken.count({ where: { userId: salma.id } })).toBe(0);
        expect(await loginStatus(salma)).toBe(403);
        expect((await http(admin.token).patch(`/admin/users/${salma.id}/status`, { status: "BLOCKED" })).status).toBe(409);

        const blocked = await http(admin.token).get("/admin/users?status=BLOCKED");

        expect(blocked.body.meta.total).toBe(1);
        expect(blocked.body.data[0].id).toBe(salma.id);
    });

    it("unblocks a user", async () => {
        const res = await http(admin.token).patch(`/admin/users/${salma.id}/status`, { status: "ACTIVE" });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("ACTIVE");
        expect(await loginStatus(salma)).toBe(200);
    });
});

describe("delete", () => {
    it("refuses own account and a citizen with open complaints", async () => {
        expect((await http(admin.token).delete(`/admin/users/${admin.id}`)).status).toBe(400);
        expect((await http(admin.token).delete(`/admin/users/${karim.id}`)).status).toBe(409);
    });

    it("soft deletes a user and keeps the email reserved", async () => {
        expect((await http(admin.token).delete(`/admin/users/${salma.id}`)).status).toBe(200);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: salma.id } })).deletedAt).not.toBeNull();
        expect(await prisma.refreshToken.count({ where: { userId: salma.id } })).toBe(0);
        expect(await loginStatus(salma)).toBe(401);
        expect((await http(admin.token).get("/admin/users?searchTerm=salma")).body.meta.total).toBe(0);
        expect((await http(admin.token).delete(`/admin/users/${salma.id}`)).status).toBe(404);
        expect((await http().post("/auth/register", { name: "Salma Again", email: salma.email, password: TEST_PASSWORD })).status).toBe(
            409
        );
    });
});

describe("staff workload", () => {
    it("lists every staff member, least busy first", async () => {
        const res = await http(admin.token).get("/admin/staff-workload");

        expect(res.status).toBe(200);
        expect(res.body.data.map((item: { id: string }) => item.id)).toEqual([newStaff.id, staff.id]);
        expect(res.body.data[0].activeAssignments).toBe(0);
        expect(res.body.data[1]).toMatchObject({ activeAssignments: 1, capacity: 2, isAvailable: true });
    });

    it("filters by department", async () => {
        const res = await http(admin.token).get(`/admin/staff-workload?departmentId=${waste.id}`);

        expect(res.body.data.map((item: { id: string }) => item.id)).toEqual([newStaff.id]);
    });
});

describe("audit trail", () => {
    it("records every user change with the admin as actor", async () => {
        const logs = await prisma.auditLog.findMany({ where: { entityType: "USER" } });
        const actions = new Set(logs.map((log) => log.action));

        for (const action of ["USER_CREATED", "USER_ROLE_CHANGED", "USER_STATUS_CHANGED", "USER_DELETED"]) {
            expect(actions.has(action), action).toBe(true);
        }

        expect(logs.every((log) => log.actorId === admin.id)).toBe(true);
    });

    it("stores the role before and after a change", async () => {
        const firstChange = await prisma.auditLog.findFirstOrThrow({
            where: { action: "USER_ROLE_CHANGED" },
            orderBy: { createdAt: "asc" },
        });

        expect(firstChange.entityId).toBe(rahim.id);
        expect(firstChange.metadata).toEqual({
            from: { role: "CITIZEN", departmentId: null },
            to: { role: "STAFF", departmentId: roads.id },
        });
    });
});
