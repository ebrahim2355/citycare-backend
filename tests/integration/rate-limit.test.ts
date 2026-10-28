import { type AddressInfo, connect, createServer, type Server, type Socket } from "node:net";
import type { Application } from "express";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, type MockInstance, vi } from "vitest";

const closers: (() => Promise<void>)[] = [];

const loadApp = async (env: Record<string, string>) => {
    vi.unstubAllEnvs();
    for (const [name, value] of Object.entries(env)) {
        vi.stubEnv(name, value);
    }
    vi.resetModules();

    const { default: app } = await import("../../src/app");
    const { default: prisma } = await import("../../src/lib/prisma");
    const { default: getRedis } = await import("../../src/lib/redis");
    const redis = getRedis();

    closers.push(async () => {
        await prisma.$disconnect();
        redis?.disconnect();
    });

    return { app, redis };
};

type TLoadedApp = Awaited<ReturnType<typeof loadApp>>;

const failedLogin = (app: Application) => {
    return request(app).post("/api/v1/auth/login").send({ email: "nobody@test.com", password: "wrongpass1" });
};

const statusesOf = async (count: number, send: () => PromiseLike<{ status: number }>) => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < count; attempt++) {
        statuses.push((await send()).status);
    }

    return statuses;
};

const closedPort = () => {
    return new Promise<number>((resolve) => {
        const server = createServer();

        server.listen(0, "127.0.0.1", () => {
            const { port } = server.address() as AddressInfo;

            server.close(() => resolve(port));
        });
    });
};

beforeAll(async () => {
    const { resetDatabase } = await import("../helpers/db");

    await resetDatabase();
});

afterAll(async () => {
    for (const close of closers) {
        await close();
    }
    vi.unstubAllEnvs();
});

describe("with the redis store", () => {
    let first: TLoadedApp;

    beforeAll(async () => {
        first = await loadApp({ AUTH_RATE_LIMIT_MAX: "5", RATE_LIMIT_MAX: "12" });
    });

    it("lets 5 login attempts through and limits the next ones", async () => {
        const statuses = await statusesOf(6, () => failedLogin(first.app));
        const res = await failedLogin(first.app);

        expect([...statuses, res.status]).toEqual([401, 401, 401, 401, 401, 429, 429]);
        expect(res.body).toMatchObject({ success: false, message: "Too many requests", errors: [expect.any(Object)] });
        expect(res.headers.ratelimit).toEqual(expect.any(String));
        expect(res.headers["ratelimit-policy"]).toEqual(expect.any(String));
        expect(res.headers["retry-after"]).toEqual(expect.any(String));
    });

    it("keeps the counters in redis", async () => {
        const keys = await first.redis?.keys("citycare:ratelimit:*");

        expect(keys).toEqual(
            expect.arrayContaining([expect.stringMatching(/^citycare:ratelimit:auth:/), expect.stringMatching(/^citycare:ratelimit:api:/)])
        );
    });

    it("keeps other routes working while login is limited", async () => {
        expect((await request(first.app).get("/api/v1/departments")).status).toBe(200);
    });

    it("shares the counters with a second server instance", async () => {
        const second = await loadApp({ AUTH_RATE_LIMIT_MAX: "5", RATE_LIMIT_MAX: "12" });

        expect((await failedLogin(second.app)).status).toBe(429);
    });

    it("applies the general limit to every route", async () => {
        const statuses = await statusesOf(8, () => request(first.app).get("/api/v1/departments"));

        expect(statuses).toEqual([200, 200, 200, 429, 429, 429, 429, 429]);
    });
});

describe("when redis is down", () => {
    let down: TLoadedApp;
    let consoleError: MockInstance;

    beforeAll(async () => {
        consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        down = await loadApp({ REDIS_URL: `redis://127.0.0.1:${await closedPort()}`, AUTH_RATE_LIMIT_MAX: "5" });
    });

    afterAll(() => {
        down.redis?.disconnect();
        consoleError.mockRestore();
    });

    it("keeps serving, reports redis as down and reads from the database", async () => {
        const started = Date.now();
        const [health, departments, login] = await Promise.all([
            request(down.app).get("/api/v1/health"),
            request(down.app).get("/api/v1/departments"),
            failedLogin(down.app),
        ]);

        expect(health.status).toBe(200);
        expect(health.body.data).toMatchObject({ database: "up", redis: "down" });
        expect(departments.status).toBe(200);
        expect(departments.headers["x-cache"]).toBe("MISS");
        expect(login.status).toBe(401);
        expect(Date.now() - started).toBeLessThan(2500);
        expect(consoleError).toHaveBeenCalledWith(
            "express-rate-limit: error from store, allowing request without rate-limiting.",
            expect.anything()
        );
    });

    it("answers at once instead of waiting for redis to reconnect", async () => {
        const started = Date.now();
        const [departments, login] = await Promise.all([request(down.app).get("/api/v1/departments"), failedLogin(down.app)]);

        expect(departments.status).toBe(200);
        expect(login.status).toBe(401);
        expect(Date.now() - started).toBeLessThan(800);
    });

    it("survives the reconnect errors", async () => {
        await new Promise((resolve) => setTimeout(resolve, 1500));

        expect((await request(down.app).get("/api/v1/health/live")).status).toBe(200);
    });
});

describe("when redis comes back after a cold start without it", () => {
    let late: TLoadedApp;
    let proxy: Server;
    let port: number;
    let consoleError: MockInstance;
    const sockets: Socket[] = [];
    const target = new URL(process.env.REDIS_URL || "redis://127.0.0.1:6379");

    beforeAll(async () => {
        consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        port = await closedPort();
        late = await loadApp({ REDIS_URL: `redis://127.0.0.1:${port}${target.pathname}`, AUTH_RATE_LIMIT_MAX: "3" });
    });

    afterAll(async () => {
        late.redis?.disconnect();
        for (const socket of sockets) {
            socket.destroy();
        }
        await new Promise((resolve) => proxy?.close(resolve));
        consoleError.mockRestore();
    });

    it("allows requests while redis is missing", async () => {
        expect((await failedLogin(late.app)).status).toBe(401);
    });

    it("limits again once redis is reachable, even after the scripts were flushed", async () => {
        const admin = new Redis(target.toString());

        await admin.script("FLUSH");
        await admin.flushdb();
        admin.disconnect();

        proxy = createServer((client) => {
            const upstream = connect(Number(target.port || 6379), target.hostname);

            sockets.push(client, upstream);
            client.pipe(upstream).pipe(client);
            client.on("error", () => upstream.destroy());
            upstream.on("error", () => client.destroy());
        });
        await new Promise<void>((resolve) => proxy.listen(port, "127.0.0.1", resolve));

        await vi.waitFor(() => expect(late.redis?.status).toBe("ready"), { timeout: 15000, interval: 200 });

        expect(await statusesOf(4, () => failedLogin(late.app))).toEqual([401, 401, 401, 429]);
    });
});

describe("when the connection to redis drops", () => {
    let dropped: TLoadedApp;

    beforeAll(async () => {
        dropped = await loadApp({});
    });

    it("opens no connection until a request needs redis", () => {
        expect(dropped.redis?.status).toBe("wait");
    });

    it("reconnects inside the next request instead of skipping redis", async () => {
        expect((await request(dropped.app).get("/api/v1/health")).body.data.redis).toBe("up");

        const admin = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");

        await admin.call("CLIENT", "KILL", "ID", String(await dropped.redis?.call("CLIENT", "ID")));
        admin.disconnect();
        await vi.waitFor(() => expect(dropped.redis?.status).not.toBe("ready"));

        const health = await request(dropped.app).get("/api/v1/health");

        expect(health.body.data).toMatchObject({ database: "up", redis: "up" });
    });
});

describe("without redis", () => {
    let memory: TLoadedApp;

    beforeAll(async () => {
        memory = await loadApp({ REDIS_URL: "", AUTH_RATE_LIMIT_MAX: "3" });
    });

    it("reports redis as disabled", async () => {
        const res = await request(memory.app).get("/api/v1/health");

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ database: "up", redis: "disabled" });
    });

    it("still limits login with the memory store", async () => {
        expect(await statusesOf(5, () => failedLogin(memory.app))).toEqual([401, 401, 401, 429, 429]);
    });
});
