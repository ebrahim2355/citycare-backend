import { expect } from "vitest";
import { CategoryType, Role, UserStatus } from "../../src/generated/prisma/client";
import prisma from "../../src/lib/prisma";
import { createAccessToken } from "../../src/utils/jwt";
import { hashPassword } from "../../src/utils/password";
import { http } from "./http";

export const TEST_PASSWORD = "Secret12345";

let passwordHash: Promise<string> | undefined;
let sequence = 0;

const nextId = () => `${Date.now().toString(36)}${(sequence++).toString(36)}`;

export interface ITestUser {
    id: string;
    name: string;
    email: string;
    role: Role;
    departmentId: string | null;
    password: string;
    token: string;
}

interface IUserOptions {
    role?: Role;
    name?: string;
    email?: string;
    departmentId?: string | null;
    status?: UserStatus;
    acceptsAssignments?: boolean;
    phone?: string;
}

export const createUser = async (options: IUserOptions = {}): Promise<ITestUser> => {
    const role = options.role ?? Role.CITIZEN;
    const label = role.toLowerCase();

    passwordHash ??= hashPassword(TEST_PASSWORD);

    const user = await prisma.user.create({
        data: {
            name: options.name ?? `Test ${label} ${nextId()}`,
            email: (options.email ?? `${label}-${nextId()}@test.com`).toLowerCase(),
            password: await passwordHash,
            role,
            status: options.status ?? UserStatus.ACTIVE,
            departmentId: options.departmentId ?? null,
            acceptsAssignments: options.acceptsAssignments ?? true,
            phone: options.phone ?? null,
        },
        select: { id: true, name: true, email: true, role: true, departmentId: true },
    });

    return { ...user, password: TEST_PASSWORD, token: createAccessToken({ id: user.id, email: user.email, role: user.role }) };
};

export const createDepartment = (name = `Department ${nextId()}`) => {
    return prisma.department.create({ data: { name } });
};

interface ICategoryOptions {
    name?: string;
    type?: CategoryType;
    fee?: number;
    slaHours?: number;
    isActive?: boolean;
}

export const createCategory = (departmentId: string, options: ICategoryOptions = {}) => {
    return prisma.category.create({
        data: {
            name: options.name ?? `Category ${nextId()}`,
            type: options.type ?? CategoryType.COMPLAINT,
            fee: options.fee ?? 0,
            slaHours: options.slaHours ?? 72,
            isActive: options.isActive ?? true,
            departmentId,
        },
    });
};

export const createCity = async () => {
    const roads = await createDepartment("Roads & Transport");
    const waste = await createDepartment("Waste Management");
    const pothole = await createCategory(roads.id, { name: "Pothole", slaHours: 48 });
    const light = await createCategory(roads.id, { name: "Street light", slaHours: 24 });
    const garbage = await createCategory(waste.id, { name: "Garbage not collected", slaHours: 24 });
    const bulk = await createCategory(waste.id, { name: "Bulk waste pickup", type: CategoryType.SERVICE, fee: 15, slaHours: 72 });
    const admin = await createUser({ role: Role.ADMIN, name: "City Admin" });
    const roadsStaff = await createUser({ role: Role.STAFF, name: "Staff One", departmentId: roads.id });
    const roadsStaff2 = await createUser({ role: Role.STAFF, name: "Staff Two", departmentId: roads.id });
    const wasteStaff = await createUser({ role: Role.STAFF, name: "Waste Staff", departmentId: waste.id });
    const citizen = await createUser({ name: "Citizen One" });
    const citizen2 = await createUser({ name: "Citizen Two" });

    return { roads, waste, pothole, light, garbage, bulk, admin, roadsStaff, roadsStaff2, wasteStaff, citizen, citizen2 };
};

export const complaintBody = (categoryId: string, extra: Record<string, unknown> = {}) => ({
    title: "Deep pothole near the school gate",
    description: "A deep pothole on the main road is causing accidents every day.",
    categoryId,
    address: "Road 7, Block C, Mirpur 10",
    area: "Mirpur",
    ...extra,
});

export const submitComplaint = async (citizen: ITestUser, categoryId: string, extra: Record<string, unknown> = {}) => {
    const res = await http(citizen.token).post("/complaints", complaintBody(categoryId, extra));

    expect(res.status, JSON.stringify(res.body)).toBe(201);

    return res.body.data;
};

export const assignTo = async (admin: ITestUser, complaintId: string, staffId?: string) => {
    const res = await http(admin.token).post(`/complaints/${complaintId}/assign`, staffId ? { staffId } : {});

    expect(res.status, JSON.stringify(res.body)).toBe(200);

    return res.body.data;
};

export const moveStatus = async (user: ITestUser, complaintId: string, status: string, note?: string) => {
    const res = await http(user.token).patch(`/complaints/${complaintId}/status`, note ? { status, note } : { status });

    expect(res.status, JSON.stringify(res.body)).toBe(200);

    return res.body.data;
};

export const resolveComplaint = async (admin: ITestUser, staff: ITestUser, complaintId: string) => {
    await assignTo(admin, complaintId, staff.id);
    await moveStatus(staff, complaintId, "IN_PROGRESS");

    return moveStatus(staff, complaintId, "RESOLVED", "Fixed and checked on site.");
};

export const login = async (email: string, password = TEST_PASSWORD) => {
    const res = await http().post("/auth/login", { email, password });

    expect(res.status, JSON.stringify(res.body)).toBe(200);

    return res.body.data as { accessToken: string; refreshToken: string; user: { id: string } };
};

export const MISSING_ID = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
