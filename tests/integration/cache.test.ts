import { beforeAll, describe, expect, it } from "vitest";
import { Role } from "../../src/generated/prisma/client";
import getRedis from "../../src/lib/redis";
import { resetDatabase } from "../helpers/db";
import { createCategory, createDepartment, createUser, type ITestUser, submitComplaint } from "../helpers/factories";
import { http } from "../helpers/http";

interface IDepartment {
    id: string;
    name: string;
    description: string | null;
    _count: { categories: number };
}

let admin: ITestUser;
let roads: { id: string };
let pothole: { id: string };

const cacheKeys = async (pattern: string) => ((await getRedis()?.keys(`citycare:cache:${pattern}`)) ?? []).sort();

const roadsIn = (departments: IDepartment[]) => departments.find((item) => item.id === roads.id);

beforeAll(async () => {
    await resetDatabase();
    expect(getRedis(), "the cache tests need TEST_REDIS_URL").not.toBeNull();
    admin = await createUser({ role: Role.ADMIN, name: "City Admin" });
    roads = await createDepartment("Roads & Transport");
});

describe("health", () => {
    it("reports redis and the database as up", async () => {
        const res = await http().get("/health");

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ database: "up", redis: "up" });
    });
});

describe("department cache", () => {
    it("serves the second read from redis with the same data", async () => {
        const first = await http().get("/departments");

        expect(first.headers["x-cache"]).toBe("MISS");
        expect(first.body.data).toHaveLength(1);

        const second = await http().get("/departments");

        expect(second.headers["x-cache"]).toBe("HIT");
        expect(second.body.data).toEqual(first.body.data);
        expect(second.body.data[0]).toMatchObject({ name: "Roads & Transport", _count: { categories: 0 } });

        const ttl = await getRedis()?.ttl("citycare:cache:departments:list");

        expect(ttl).toBeGreaterThan(200);
        expect(ttl).toBeLessThanOrEqual(300);
    });

    it("clears the list when a department is created", async () => {
        expect((await http(admin.token).post("/departments", { name: "Waste Management" })).status).toBe(201);

        const res = await http().get("/departments");

        expect(res.headers["x-cache"]).toBe("MISS");
        expect(res.body.data).toHaveLength(2);
    });

    it("clears the list when a department is updated", async () => {
        expect((await http(admin.token).patch(`/departments/${roads.id}`, { description: "Roads and traffic" })).status).toBe(200);

        const res = await http().get("/departments");

        expect(res.headers["x-cache"]).toBe("MISS");
        expect(roadsIn(res.body.data)?.description).toBe("Roads and traffic");
    });
});

describe("category cache", () => {
    it("clears the department list when a category is added, because its count changes", async () => {
        const created = await http(admin.token).post("/categories", { name: "Pothole", departmentId: roads.id });

        expect(created.status).toBe(201);
        pothole = created.body.data;

        const res = await http().get("/departments");

        expect(res.headers["x-cache"]).toBe("MISS");
        expect(roadsIn(res.body.data)?._count.categories).toBe(1);
    });

    it("caches the category list", async () => {
        const first = await http().get("/categories");

        expect(first.headers["x-cache"]).toBe("MISS");
        expect(first.body.data).toHaveLength(1);

        const second = await http().get("/categories");

        expect(second.headers["x-cache"]).toBe("HIT");
        expect(Number(second.body.data[0].fee)).toBe(0);
        expect(second.body.data[0].department.name).toBe("Roads & Transport");
    });

    it("keeps one cache entry per filter", async () => {
        const first = await http().get("/categories?type=SERVICE");

        expect(first.headers["x-cache"]).toBe("MISS");
        expect(first.body.data).toHaveLength(0);
        expect((await http().get("/categories?type=SERVICE")).headers["x-cache"]).toBe("HIT");
        expect(await cacheKeys("categories:*")).toEqual(["citycare:cache:categories:SERVICE:all", "citycare:cache:categories:all:all"]);
    });

    it("never caches a search", async () => {
        const first = await http().get("/categories?searchTerm=pot");

        expect(first.headers["x-cache"]).toBe("MISS");
        expect(first.body.data).toHaveLength(1);
        expect((await http().get("/categories?searchTerm=pot")).headers["x-cache"]).toBe("MISS");
    });

    it("clears every catalog list when a category changes", async () => {
        expect((await http(admin.token).patch(`/categories/${pothole.id}`, { isActive: false })).status).toBe(200);
        expect(await cacheKeys("*")).toEqual([]);

        const list = await http().get("/categories");

        expect(list.headers["x-cache"]).toBe("MISS");
        expect(list.body.data).toHaveLength(0);
        expect((await http().get("/categories?type=SERVICE")).headers["x-cache"]).toBe("MISS");
    });

    it("never serves the admin view with inactive categories from the cache", async () => {
        const first = await http(admin.token).get("/categories?includeInactive=true");

        expect(first.headers["x-cache"]).toBe("MISS");
        expect(first.body.data).toHaveLength(1);
        expect((await http(admin.token).get("/categories?includeInactive=true")).headers["x-cache"]).toBe("MISS");
    });

    it("drops a deleted category from the admin view", async () => {
        expect((await http(admin.token).delete(`/categories/${pothole.id}`)).status).toBe(200);

        const res = await http(admin.token).get("/categories?includeInactive=true");

        expect(res.status).toBe(200);
        expect(res.body.data).toHaveLength(0);
    });
});

describe("public report cache", () => {
    let owner: ITestUser;
    let neighbour: ITestUser;
    let report: { id: string };

    const publicFeed = async () => {
        const res = await http().get("/complaints/public");

        expect(res.status).toBe(200);

        return { cache: res.headers["x-cache"], reports: res.body.data as { id: string; supportCount: number }[] };
    };

    beforeAll(async () => {
        const footpath = await createCategory(roads.id, { name: "Broken footpath" });

        owner = await createUser({ name: "Report Owner" });
        neighbour = await createUser({ name: "Next Door" });
        report = await submitComplaint(owner, footpath.id, { latitude: 23.7461, longitude: 90.3742, isPublic: true });
    });

    it("serves the map feed from redis while nothing changes", async () => {
        const first = await publicFeed();

        expect(first.cache).toBe("MISS");
        expect(first.reports.map((item) => item.id)).toEqual([report.id]);
        expect((await publicFeed()).cache).toBe("HIT");
    });

    it("shows a new support at once", async () => {
        expect((await http(neighbour.token).post(`/complaints/${report.id}/support`)).status).toBe(200);

        const feed = await publicFeed();

        expect(feed.cache).toBe("MISS");
        expect(feed.reports[0]?.supportCount).toBe(1);
    });

    it("drops a report as soon as its owner makes it private", async () => {
        expect((await publicFeed()).cache).toBe("HIT");
        expect((await http(owner.token).patch(`/complaints/${report.id}`, { isPublic: false })).status).toBe(200);
        expect((await publicFeed()).reports).toEqual([]);
    });

    it("drops a report at once when an admin removes it", async () => {
        expect((await http(owner.token).patch(`/complaints/${report.id}`, { isPublic: true })).status).toBe(200);
        expect((await publicFeed()).reports).toHaveLength(1);
        expect((await publicFeed()).cache).toBe("HIT");
        expect((await http(admin.token).delete(`/complaints/${report.id}`)).status).toBe(200);
        expect((await publicFeed()).reports).toEqual([]);
    });
});
