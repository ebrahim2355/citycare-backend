import { createHash } from "node:crypto";
import type { Application } from "express";
import type { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as Db from "../helpers/db";

const KEY = "citycare-test-internal-key";
const PASSWORD = "secret123";

let app: Application;
let redis: Redis;
let prisma: typeof Db.prisma;
let resetDatabase: typeof Db.resetDatabase;
let close: () => Promise<void>;
let userId: string;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const failedLogin = (headers: Record<string, string>) => {
    return request(app).post("/api/v1/auth/login").set(headers).send({ email: "nobody@example.com", password: "x" });
};

const statusesOf = async (count: number, headers: Record<string, string>) => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < count; attempt++) {
        statuses.push((await failedLogin(headers)).status);
    }

    return statuses;
};

const limitedKeys = async () => {
    return (await redis.keys("citycare:ratelimit:auth:*")).map((key) => key.replace("citycare:ratelimit:auth:", "")).sort();
};

beforeAll(async () => {
    ({ prisma, resetDatabase } = await import("../helpers/db"));
    vi.stubEnv("AUTH_RATE_LIMIT_MAX", "3");
    vi.resetModules();
    app = (await import("../../src/app")).default;

    const { default: freshPrisma } = await import("../../src/lib/prisma");
    const { default: getRedis } = await import("../../src/lib/redis");

    redis = getRedis() as Redis;
    close = async () => {
        await freshPrisma.$disconnect();
        redis.disconnect();
    };
});

afterAll(async () => {
    await close();
    vi.unstubAllEnvs();
});

describe("rate limit key", () => {
    beforeAll(async () => {
        await resetDatabase();
    });

    it("limits every client ip sent by the trusted frontend server on its own", async () => {
        expect(await statusesOf(4, { "x-internal-key": KEY, "x-client-ip": "203.0.113.10" })).toEqual([401, 401, 401, 429]);
        expect(await statusesOf(1, { "x-internal-key": KEY, "x-client-ip": "203.0.113.20" })).toEqual([401]);
    });

    it("ignores the client ip header without the right key", async () => {
        expect(await statusesOf(1, { "x-internal-key": "wrong-key-wrong-key-wrong-key-xx", "x-client-ip": "203.0.113.30" })).toEqual([401]);
        expect(await statusesOf(3, { "x-client-ip": "203.0.113.40" })).toEqual([401, 401, 429]);
        expect(await statusesOf(1, { "x-client-ip": "203.0.113.50" })).toEqual([429]);
    });

    it("counts in redis per client ip", async () => {
        expect(await limitedKeys()).toEqual(["127.0.0.1", "203.0.113.10", "203.0.113.20"]);
    });
});

describe("session details", () => {
    beforeAll(async () => {
        await resetDatabase();
    });

    it("keeps the client ip and browser sent by the trusted frontend server", async () => {
        const res = await request(app)
            .post("/api/v1/auth/register")
            .set({ "x-internal-key": KEY, "x-client-ip": "198.51.100.7", "x-client-user-agent": "Mozilla/5.0 Test" })
            .send({ name: "Ip Check", email: "ip@example.com", password: PASSWORD });

        expect(res.status).toBe(201);
        userId = res.body.data.user.id;

        const session = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(res.body.data.refreshToken) } });

        expect(session).toMatchObject({ userId, ipAddress: "198.51.100.7", userAgent: "Mozilla/5.0 Test" });
    });

    it("keeps the own address and browser when the headers come without the key", async () => {
        const res = await request(app)
            .post("/api/v1/auth/login")
            .set({ "x-client-ip": "198.51.100.8", "x-client-user-agent": "Spoofed", "user-agent": "citycare-tests" })
            .send({ email: "ip@example.com", password: PASSWORD });

        expect(res.status).toBe(200);

        const session = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(res.body.data.refreshToken) } });

        expect(session.userId).toBe(userId);
        expect(session.userAgent).toBe("citycare-tests");
        expect(session.ipAddress).toMatch(/(^|:)127\.0\.0\.1$/);
    });
});
