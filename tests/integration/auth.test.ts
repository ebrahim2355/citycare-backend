import { createHash } from "node:crypto";
import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { UserStatus } from "../../src/generated/prisma/client";
import { prisma, resetDatabase } from "../helpers/db";
import { login } from "../helpers/factories";
import { app, hasFieldError, http } from "../helpers/http";

const EMAIL = "karim@example.com";
const PASSWORD = "secret123";
const NEW_PASSWORD = "newsecret1";
const PHONE = "+8801712345678";

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const refresh = (refreshToken: string) => http().post("/auth/refresh-token", { refreshToken });

const backdateRevokedTokens = () => {
    return prisma.refreshToken.updateMany({
        where: { revokedAt: { not: null } },
        data: { revokedAt: new Date(Date.now() - 5 * 60 * 1000) },
    });
};

let userId: string;
let accessToken: string;
let refreshToken: string;

beforeAll(resetDatabase);

describe("register", () => {
    it("validates the fields", async () => {
        const res = await http().post("/auth/register", { name: "A", email: "bad", password: "short" });

        expect(res.status).toBe(400);
        for (const field of ["name", "email", "password"]) {
            expect(hasFieldError(res, field), field).toBe(true);
        }
        expect((await http().post("/auth/register", {})).status).toBe(400);
    });

    it("registers a citizen whatever role is sent and returns both tokens", async () => {
        const res = await http().post("/auth/register", {
            name: "Karim Citizen",
            email: "Karim@Example.com",
            password: PASSWORD,
            phone: PHONE,
            role: "ADMIN",
        });

        expect(res.status).toBe(201);
        expect(res.body.data.user).toMatchObject({ email: EMAIL, role: "CITIZEN", provider: "LOCAL" });
        expect(res.body.data.accessToken).toEqual(expect.any(String));
        expect(res.body.data.refreshToken).toEqual(expect.any(String));
        expect(JSON.stringify(res.body)).not.toContain("password");
        userId = res.body.data.user.id;

        const stored = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

        expect(stored.role).toBe("CITIZEN");
        expect(stored.password).toMatch(/^\$2[aby]\$/);
    });

    it("refuses a registered email in any letter case", async () => {
        const res = await http().post("/auth/register", { name: "Karim Again", email: "KARIM@example.com", password: PASSWORD });

        expect(res.status).toBe(409);
        expect(hasFieldError(res, "email")).toBe(true);
    });
});

describe("login", () => {
    it("refuses wrong credentials and a missing password", async () => {
        expect((await http().post("/auth/login", { email: EMAIL, password: "wrongpass1" })).status).toBe(401);
        expect((await http().post("/auth/login", { email: "nobody@example.com", password: PASSWORD })).status).toBe(401);

        const res = await http().post("/auth/login", { email: EMAIL });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "password")).toBe(true);
    });

    it("logs in and stores only a hash of the refresh token", async () => {
        ({ accessToken, refreshToken } = await login(EMAIL, PASSWORD));

        const hashes = (await prisma.refreshToken.findMany({ where: { userId } })).map((token) => token.tokenHash);

        expect(hashes).toContain(sha256(refreshToken));
        expect(hashes).not.toContain(refreshToken);
        expect(hashes.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
    });
});

describe("bearer token", () => {
    it("rejects a missing, malformed, forged or expired token", async () => {
        const forged = jwt.sign({ id: userId, email: EMAIL, role: "ADMIN" }, "x".repeat(40));
        const expired = jwt.sign(
            { id: userId, email: EMAIL, role: "CITIZEN", exp: Math.floor(Date.now() / 1000) - 10 },
            process.env.JWT_ACCESS_SECRET as string
        );

        expect((await http().get("/users/me")).status).toBe(401);
        expect((await http(undefined, { Authorization: accessToken }).get("/users/me")).status).toBe(401);
        expect((await http("not-a-token").get("/users/me")).status).toBe(401);
        expect((await http(forged).get("/users/me")).status).toBe(401);
        expect((await http(expired).get("/users/me")).status).toBe(401);
    });

    it("returns the profile for a valid token", async () => {
        const res = await http(accessToken).get("/users/me");

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ id: userId, email: EMAIL, phone: PHONE });
    });
});

describe("profile", () => {
    it("validates the update", async () => {
        expect((await http(accessToken).patch("/users/me", {})).status).toBe(400);

        const res = await http(accessToken).patch("/users/me", { phone: "abc" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "phone")).toBe(true);
    });

    it("changes the profile but never the role or the email", async () => {
        const res = await http(accessToken).patch("/users/me", {
            name: "Karim Uddin",
            address: "House 4, Road 2, Mirpur",
            role: "ADMIN",
            email: "x@y.com",
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ name: "Karim Uddin", address: "House 4, Road 2, Mirpur", role: "CITIZEN", email: EMAIL });
    });
});

describe("refresh token", () => {
    it("needs a known refresh token", async () => {
        expect((await http().post("/auth/refresh-token", {})).status).toBe(400);
        expect((await refresh("x".repeat(80))).status).toBe(401);
    });

    it("rotates the pair and revokes the used token", async () => {
        const res = await refresh(refreshToken);

        expect(res.status).toBe(200);
        expect(res.body.data.accessToken).toEqual(expect.any(String));
        expect(res.body.data.refreshToken).not.toBe(refreshToken);

        const next = await refresh(res.body.data.refreshToken);

        expect(next.status).toBe(200);
        expect((await http(next.body.data.accessToken).get("/users/me")).status).toBe(200);

        const used = await prisma.refreshToken.findUniqueOrThrow({ where: { tokenHash: sha256(refreshToken) } });

        expect(used.revokedAt).not.toBeNull();
    });

    it("still accepts the used token for a few seconds for parallel requests", async () => {
        expect((await refresh(refreshToken)).status).toBe(200);
    });

    it("refuses the used token later and ends every session of the user", async () => {
        await backdateRevokedTokens();

        expect((await refresh(refreshToken)).status).toBe(401);
        expect(await prisma.refreshToken.count({ where: { userId } })).toBe(0);
    });

    it("gives each parallel refresh its own working pair", async () => {
        const { refreshToken: shared } = await login(EMAIL, PASSWORD);
        const results = await Promise.all(Array.from({ length: 6 }, () => refresh(shared)));

        expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200, 200, 200]);
        expect(results.every((res) => typeof res.body.data.accessToken === "string")).toBe(true);
        expect(new Set(results.map((res) => res.body.data.refreshToken)).size).toBe(6);
    });

    it("revokes the newer tokens too when a rotated token is reused later", async () => {
        const { refreshToken: older } = await login(EMAIL, PASSWORD);
        const newer = (await refresh(older)).body.data.refreshToken;

        await backdateRevokedTokens();

        expect((await refresh(older)).status).toBe(401);
        expect((await refresh(newer)).status).toBe(401);
    });
});

describe("logout", () => {
    it("revokes the refresh token and can be repeated", async () => {
        ({ refreshToken } = await login(EMAIL, PASSWORD));

        expect((await http().post("/auth/logout", { refreshToken })).status).toBe(200);
        expect(await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } })).toBeNull();
        expect((await refresh(refreshToken)).status).toBe(401);
        expect((await http().post("/auth/logout", { refreshToken })).status).toBe(200);
    });
});

describe("change password", () => {
    it("needs a login, the right current password and a new strong one", async () => {
        ({ accessToken, refreshToken } = await login(EMAIL, PASSWORD));

        expect((await http().post("/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(401);

        const wrong = await http(accessToken).post("/auth/change-password", { currentPassword: "wrong1234", newPassword: NEW_PASSWORD });
        const same = await http(accessToken).post("/auth/change-password", { currentPassword: PASSWORD, newPassword: PASSWORD });
        const weak = await http(accessToken).post("/auth/change-password", { currentPassword: PASSWORD, newPassword: "weak" });

        expect(wrong.status).toBe(400);
        expect(hasFieldError(wrong, "currentPassword")).toBe(true);
        expect(same.status).toBe(400);
        expect(hasFieldError(same, "newPassword")).toBe(true);
        expect(weak.status).toBe(400);
        expect(hasFieldError(weak, "newPassword")).toBe(true);
    });

    it("changes the password, returns a new pair and ends the old sessions", async () => {
        const res = await http(accessToken).post("/auth/change-password", { currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ accessToken: expect.any(String), refreshToken: expect.any(String) });
        expect((await http(res.body.data.accessToken).get("/users/me")).status).toBe(200);
        expect((await refresh(refreshToken)).status).toBe(401);
        expect((await http().post("/auth/login", { email: EMAIL, password: PASSWORD })).status).toBe(401);
        ({ accessToken, refreshToken } = await login(EMAIL, NEW_PASSWORD));

        const logs = await prisma.auditLog.findMany({ where: { action: "PASSWORD_CHANGED" } });

        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ actorId: userId, entityType: "USER", entityId: userId });
    });
});

describe("blocked and removed users", () => {
    it("shuts out a blocked user even with valid tokens", async () => {
        await prisma.user.update({ where: { id: userId }, data: { status: UserStatus.BLOCKED } });

        expect((await http(accessToken).get("/users/me")).status).toBe(403);
        expect((await http().post("/auth/login", { email: EMAIL, password: NEW_PASSWORD })).status).toBe(403);
        expect((await refresh(refreshToken)).status).toBe(403);
    });

    it("treats a removed user as unknown", async () => {
        await prisma.user.update({ where: { id: userId }, data: { status: UserStatus.ACTIVE, deletedAt: new Date() } });

        expect((await http(accessToken).get("/users/me")).status).toBe(401);
        expect((await http().post("/auth/login", { email: EMAIL, password: NEW_PASSWORD })).status).toBe(401);
        expect((await refresh(refreshToken)).status).toBe(401);
    });
});

describe("general", () => {
    it("answers 404 for an unknown route", async () => {
        const res = await http().get("/nope");

        expect(res.status).toBe(404);
        expect(res.body.message).toBe("Route not found");
    });

    it("answers 400 for a malformed json body", async () => {
        const res = await http().upload("/auth/login").set("Content-Type", "application/json").send("{bad json");

        expect(res.status).toBe(400);
        expect(res.body.message).toBe("Invalid request body");
    });

    it("serves the api root with the security headers", async () => {
        const res = await request(app).get("/");

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, data: { baseUrl: "/api/v1" } });
        expect(res.headers["x-content-type-options"]).toBe("nosniff");
        expect(res.headers["x-powered-by"]).toBeUndefined();
    });
});
