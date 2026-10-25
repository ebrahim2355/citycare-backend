import type { Application } from "express";
import type { TokenPayload } from "google-auth-library";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as GoogleFake from "../fakes/google";
import type * as Db from "../helpers/db";
import type * as Http from "../helpers/http";

type TProfile = Partial<TokenPayload> & { sub: string; email: string };

const CLIENT_ID = "citycare-test.apps.googleusercontent.com";
const FRONTEND = "http://localhost:3000/api/auth/google/callback";
const rina: TProfile = {
    sub: "google-1001",
    email: "Rina@Gmail.com",
    name: "Rina Akter",
    picture: "https://lh3.googleusercontent.com/a/rina",
};
const karim: TProfile = { sub: "google-3003", email: "karim@gmail.com", name: "Karim G" };

let http: typeof Http.http;
let hasFieldError: typeof Http.hasFieldError;
let prisma: typeof Db.prisma;
let googleTest: typeof GoogleFake.googleTest;
let redirectUri: string;
let sequence = 0;
let rinaId: string;
let rinaToken: string;
let karimId: string;
let loginCode: string;

const idTokenFor = (profile: TProfile) => googleTest.profile(`google-id-token-${++sequence}-${profile.sub}`, profile);

const codeFor = (profile: TProfile) => googleTest.code(`google-code-${++sequence}`, idTokenFor(profile));

const getState = async (redirect?: string) => {
    const res = await http().get(`/auth/google?${new URLSearchParams({ format: "json", ...(redirect ? { redirect } : {}) })}`);

    expect(res.status).toBe(200);

    return new URL(res.body.data.url).searchParams.get("state") as string;
};

const callback = (query: Record<string, string>) => http().get(`/auth/google/callback?${new URLSearchParams(query)}`);

const frontendCallback = async (query: Record<string, string>) => {
    const res = await http().raw.get(`/auth/google/callback?${new URLSearchParams(query)}`);

    expect(res.status).toBe(302);

    return new URL(res.headers.location as string);
};

const loginWithIdToken = (idToken: string) => http().post("/auth/google", { idToken });

beforeAll(async () => {
    const db = await import("../helpers/db");

    ({ http, hasFieldError } = await import("../helpers/http"));
    ({ googleTest } = await import("../fakes/google"));
    ({ prisma } = db);
    redirectUri = (await import("../../src/config")).default.google.redirectUri;
    await db.resetDatabase();
});

describe("starting the login", () => {
    it("redirects to Google with the client id, the scopes and a signed state", async () => {
        const res = await http().raw.get("/auth/google");
        const location = new URL(res.headers.location as string);
        const state = location.searchParams.get("state") as string;

        expect(res.status).toBe(302);
        expect(location.hostname).toBe("accounts.google.test");
        expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
        expect(location.searchParams.get("scope")).toContain("email");
        expect(state.split(".")).toHaveLength(3);
        expect(googleTest.client.generateAuthUrl).toHaveBeenLastCalledWith({
            access_type: "online",
            scope: ["openid", "email", "profile"],
            prompt: "select_account",
            state,
        });
        expect(redirectUri).toBe("http://localhost:5000/api/v1/auth/google/callback");
    });

    it("returns the login url as json on request", async () => {
        const res = await http().get("/auth/google?format=json");

        expect(res.status).toBe(200);
        expect(res.body.data.url).toMatch(/^https:\/\/accounts\.google\.test\//);
    });

    it("accepts only a redirect to an allowed frontend", async () => {
        const evil = await http().get(`/auth/google?redirect=${encodeURIComponent("https://evil.example.com/callback")}`);
        const broken = await http().get("/auth/google?redirect=not-a-url");
        const allowed = await http().get(`/auth/google?format=json&redirect=${encodeURIComponent("http://localhost:3001/login")}`);

        expect(evil.status).toBe(400);
        expect(hasFieldError(evil, "redirect")).toBe(true);
        expect(broken.status).toBe(400);
        expect(hasFieldError(broken, "redirect")).toBe(true);
        expect(allowed.status).toBe(200);
    });
});

describe("callback without a frontend", () => {
    it("needs a valid state", async () => {
        expect((await http().get("/auth/google/callback?code=abc")).status).toBe(400);
        expect((await callback({ code: "abc", state: "aaaaaaaaaaaaaaaaaaaa" })).status).toBe(400);
    });

    it("refuses a bad code and a cancelled login", async () => {
        const state = await getState();

        expect((await callback({ state, code: "wrong-code" })).status).toBe(401);
        expect((await callback({ state, error: "access_denied" })).status).toBe(400);
    });

    it("creates a citizen account from the Google profile", async () => {
        const res = await callback({ state: await getState(), code: codeFor(rina) });

        expect(res.status).toBe(200);
        expect(res.body.data.user).toMatchObject({ email: "rina@gmail.com", provider: "GOOGLE", role: "CITIZEN", name: "Rina Akter" });
        expect(res.body.data.user.avatarUrl).toContain("rina");
        expect(res.body.data.accessToken).toEqual(expect.any(String));
        expect(res.body.data.refreshToken).toEqual(expect.any(String));
        rinaId = res.body.data.user.id;

        const stored = await prisma.user.findUniqueOrThrow({ where: { id: rinaId } });

        expect(stored.googleId).toBe("google-1001");
        expect(stored.password).toBeNull();

        const me = await http(res.body.data.accessToken).get("/users/me");

        expect(me.status).toBe(200);
        expect(me.body.data.id).toBe(rinaId);
        expect((await http().post("/auth/refresh-token", { refreshToken: res.body.data.refreshToken })).status).toBe(200);
    });

    it("uses the same account on the next login", async () => {
        const res = await callback({ state: await getState(), code: codeFor(rina) });

        expect(res.status).toBe(200);
        expect(res.body.data.user.id).toBe(rinaId);
        expect(await prisma.user.count()).toBe(1);
    });

    it("refuses a password login for a Google only account", async () => {
        expect((await http().post("/auth/login", { email: "rina@gmail.com", password: "secret123" })).status).toBe(400);
    });

    it("refuses a Google account with an unverified email", async () => {
        const unverified = { ...rina, sub: "google-2002", email: "unverified@gmail.com", email_verified: false };

        expect((await callback({ state: await getState(), code: codeFor(unverified) })).status).toBe(403);
        expect(await prisma.user.count()).toBe(1);
    });
});

describe("linking with an existing account", () => {
    it("links a Google login to the account with the same email", async () => {
        const registered = await http().post("/auth/register", { name: "Karim Citizen", email: "karim@gmail.com", password: "secret123" });

        expect(registered.status).toBe(201);
        karimId = registered.body.data.user.id;

        const res = await callback({ state: await getState(), code: codeFor(karim) });

        expect(res.status).toBe(200);
        expect(res.body.data.user).toMatchObject({ id: karimId, name: "Karim Citizen" });
        expect((await prisma.user.findUniqueOrThrow({ where: { id: karimId } })).googleId).toBe("google-3003");
        expect((await http().post("/auth/login", { email: "karim@gmail.com", password: "secret123" })).status).toBe(200);
    });

    it("refuses another Google account with the same email", async () => {
        const other = { sub: "google-9999", email: "karim@gmail.com", name: "Other" };

        expect((await callback({ state: await getState(), code: codeFor(other) })).status).toBe(409);
    });

    it("refuses a blocked or removed account", async () => {
        await prisma.user.update({ where: { id: karimId }, data: { status: "BLOCKED" } });

        expect((await callback({ state: await getState(), code: codeFor(karim) })).status).toBe(403);

        await prisma.user.update({ where: { id: karimId }, data: { status: "ACTIVE", deletedAt: new Date() } });

        expect((await callback({ state: await getState(), code: codeFor(karim) })).status).toBe(401);
    });
});

describe("callback with a frontend", () => {
    it("redirects back with a one time login code instead of the tokens", async () => {
        const back = await frontendCallback({ state: await getState(FRONTEND), code: codeFor(rina) });

        expect(`${back.origin}${back.pathname}`).toBe(FRONTEND);
        expect(back.searchParams.get("code")).toEqual(expect.any(String));
        expect(back.search).not.toContain("accessToken");
        loginCode = back.searchParams.get("code") as string;
    });

    it("exchanges the login code for tokens only once", async () => {
        expect((await http().post("/auth/google/exchange", { code: `${loginCode}x` })).status).toBe(401);

        const res = await http().post("/auth/google/exchange", { code: loginCode });

        expect(res.status).toBe(200);
        expect(res.body.data.user.id).toBe(rinaId);
        expect(res.body.data.accessToken).toEqual(expect.any(String));
        expect(res.body.data.refreshToken).toEqual(expect.any(String));
        expect((await http().post("/auth/google/exchange", { code: loginCode })).status).toBe(401);
        expect((await http().post("/auth/google/exchange", {})).status).toBe(400);
    });

    it("sends failures back to the frontend with an error", async () => {
        const failed = await frontendCallback({ state: await getState(FRONTEND), code: "wrong-code" });
        const cancelled = await frontendCallback({ state: await getState(FRONTEND), error: "access_denied" });

        expect(`${failed.origin}${failed.pathname}`).toBe(FRONTEND);
        expect(failed.searchParams.get("error")).toBe("Google login failed");
        expect(failed.searchParams.get("code")).toBeNull();
        expect(cancelled.searchParams.get("error")).toBe("Google login was cancelled");
    });
});

describe("id token login", () => {
    it("needs an id token that Google accepts for this app", async () => {
        expect((await http().post("/auth/google", {})).status).toBe(400);
        expect((await loginWithIdToken("this-is-not-a-jwt-at-all-12345")).status).toBe(401);
        expect(googleTest.client.verifyIdToken).toHaveBeenLastCalledWith({
            idToken: "this-is-not-a-jwt-at-all-12345",
            audience: CLIENT_ID,
        });
    });

    it("logs in an existing Google user", async () => {
        const res = await loginWithIdToken(idTokenFor({ sub: "google-1001", email: "rina@gmail.com", name: "Rina Akter" }));

        expect(res.status).toBe(200);
        expect(res.body.data.user.id).toBe(rinaId);
        expect(res.body.data.accessToken).toEqual(expect.any(String));
        rinaToken = res.body.data.accessToken;
    });

    it("creates a new account and takes the name from the email", async () => {
        const res = await loginWithIdToken(idTokenFor({ sub: "google-5005", email: "new.user@gmail.com" }));

        expect(res.status).toBe(200);
        expect(res.body.data.user).toMatchObject({ name: "new.user", provider: "GOOGLE" });
    });

    it("creates one account for parallel first logins", async () => {
        const idToken = idTokenFor({ sub: "google-6006", email: "race@gmail.com" });
        const results = await Promise.all(Array.from({ length: 5 }, () => loginWithIdToken(idToken)));

        expect(results.map((res) => res.status)).toEqual([200, 200, 200, 200, 200]);
        expect(new Set(results.map((res) => res.body.data.user.id)).size).toBe(1);
        expect(await prisma.user.count({ where: { email: "race@gmail.com" } })).toBe(1);
    });
});

describe("Google user sets a password", () => {
    it("sets a first password without a current one and can then login with it", async () => {
        expect((await http(rinaToken).post("/auth/change-password", { newPassword: "mypassword1" })).status).toBe(200);
        expect((await http().post("/auth/login", { email: "rina@gmail.com", password: "mypassword1" })).status).toBe(200);
    });
});

describe("without the Google keys", () => {
    let bare: Application;
    let close: () => Promise<void>;

    beforeAll(async () => {
        vi.stubEnv("GOOGLE_CLIENT_ID", "");
        vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
        vi.doUnmock("../../src/lib/google");
        vi.resetModules();
        bare = (await import("../../src/app")).default;

        const { default: barePrisma } = await import("../../src/lib/prisma");
        const { default: getRedis } = await import("../../src/lib/redis");

        close = async () => {
            await barePrisma.$disconnect();
            getRedis()?.disconnect();
        };
    });

    afterAll(async () => {
        await close();
        vi.unstubAllEnvs();
    });

    it("answers 503 for the login url and the id token login", async () => {
        const start = await request(bare).get("/api/v1/auth/google");
        const idToken = await request(bare)
            .post("/api/v1/auth/google")
            .send({ idToken: "x".repeat(40) });

        expect(start.status).toBe(503);
        expect(start.body).toMatchObject({ success: false, message: "Google login is not configured" });
        expect(idToken.status).toBe(503);
        expect(idToken.body).toMatchObject({ success: false, message: "Google login is not configured" });
    });
});
