import { createHash } from "node:crypto";
import type { Application } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type * as MailFake from "../fakes/mailer";
import type * as StripeFake from "../fakes/stripe";
import type * as Db from "../helpers/db";
import type * as Factories from "../helpers/factories";
import type * as Http from "../helpers/http";

const KARIM = "karim@test.com";
const STAFF = "staff@test.com";

let http: typeof Http.http;
let hasFieldError: typeof Http.hasFieldError;
let prisma: typeof Db.prisma;
let mailTest: typeof MailFake.mailTest;
let sendEmail: typeof MailFake.sendEmail;
let stripeTest: typeof StripeFake.stripeTest;
let login: typeof Factories.login;
let complaintBody: typeof Factories.complaintBody;
let admin: Factories.ITestUser;
let wasteId: string;
let garbageId: string;
let bulkId: string;
let karimId: string;
let karimToken: string;
let registeredRefreshToken: string;
let staffToken: string;
let unknownMessage: string;
let resetToken: string;
let complaint: { id: string; trackingCode: string };
let paid: { id: string; trackingCode: string };

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const mailTo = (to: string, subject: string) => {
    const mail = mailTest.sentTo(to).findLast((item) => item.subject.includes(subject));

    expect(mail, `email "${subject}" to ${to}`).toBeDefined();

    return mail as MailFake.ISentEmail;
};

const tokenFrom = (mail: MailFake.ISentEmail) => mail.html.match(/reset-password\?token=([a-f0-9]{64})/)?.[1] as string;

const setStatus = (token: string, complaintId: string, body: { status: string; note?: string }) => {
    return http(token).patch(`/complaints/${complaintId}/status`, body);
};

beforeAll(async () => {
    const db = await import("../helpers/db");
    const factories = await import("../helpers/factories");
    const mailer = await import("../fakes/mailer");

    ({ http, hasFieldError } = await import("../helpers/http"));
    ({ stripeTest } = await import("../fakes/stripe"));
    ({ mailTest, sendEmail } = mailer);
    ({ prisma } = db);
    ({ login, complaintBody } = factories);
    await db.resetDatabase();
    admin = await factories.createUser({ role: "ADMIN", name: "City Admin" });
    wasteId = (await factories.createDepartment("Waste Management")).id;
    garbageId = (await factories.createCategory(wasteId, { name: "Garbage not collected" })).id;
    bulkId = (await factories.createCategory(wasteId, { name: "Bulk waste pickup", type: "SERVICE", fee: 15 })).id;
});

describe("welcome email", () => {
    it("welcomes a new citizen and escapes the name", async () => {
        const res = await http().post("/auth/register", { name: "Karim <b>Citizen</b>", email: KARIM, password: "secret123" });

        expect(res.status).toBe(201);
        karimId = res.body.data.user.id;
        registeredRefreshToken = res.body.data.refreshToken;

        const mail = mailTo(KARIM, "Welcome to CityCare");

        expect(mail.html).toContain("Karim &lt;b&gt;Citizen&lt;/b&gt;");
        expect(mail.html).not.toContain("<b>Citizen</b>");
    });
});

describe("forgot and reset password", () => {
    it("validates the email", async () => {
        const res = await http().post("/auth/forgot-password", { email: "nope" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "email")).toBe(true);
    });

    it("answers an unknown email without sending anything", async () => {
        const before = mailTest.outbox.length;
        const res = await http().post("/auth/forgot-password", { email: "nobody@test.com" });

        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
        expect(mailTest.outbox).toHaveLength(before);
        unknownMessage = res.body.message;
    });

    it("emails a reset link to a known email with the same answer and stores only a hash", async () => {
        const res = await http().post("/auth/forgot-password", { email: "KARIM@test.com" });

        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
        expect(res.body.message).toBe(unknownMessage);

        const mail = mailTo(KARIM, "Reset your CityCare password");

        resetToken = tokenFrom(mail);
        expect(resetToken).toMatch(/^[a-f0-9]{64}$/);
        expect(mail.html).toContain(`http://localhost:3000/reset-password?token=${resetToken}`);

        const stored = await prisma.user.findUniqueOrThrow({ where: { id: karimId } });

        expect(stored.resetTokenHash).toBe(sha256(resetToken));
        expect(stored.resetTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    });

    it("refuses a wrong token and a weak password", async () => {
        const wrong = await http().post("/auth/reset-password", { token: "a".repeat(64), newPassword: "newsecret1" });
        const weak = await http().post("/auth/reset-password", { token: resetToken, newPassword: "weak" });

        expect(wrong.status).toBe(400);
        expect(hasFieldError(wrong, "token")).toBe(true);
        expect(weak.status).toBe(400);
        expect(hasFieldError(weak, "newPassword")).toBe(true);
    });

    it("resets the password and ends the sessions from before", async () => {
        expect((await http().post("/auth/reset-password", { token: resetToken, newPassword: "newsecret1" })).status).toBe(200);
        expect((await http().post("/auth/login", { email: KARIM, password: "secret123" })).status).toBe(401);
        karimToken = (await login(KARIM, "newsecret1")).accessToken;
        expect((await http().post("/auth/refresh-token", { refreshToken: registeredRefreshToken })).status).toBe(401);
        expect((await prisma.user.findUniqueOrThrow({ where: { id: karimId } })).resetTokenHash).toBeNull();
    });

    it("accepts a reset token only once", async () => {
        expect((await http().post("/auth/reset-password", { token: resetToken, newPassword: "another123" })).status).toBe(400);
    });

    it("refuses an expired reset token", async () => {
        expect((await http().post("/auth/forgot-password", { email: KARIM })).status).toBe(200);

        const token = tokenFrom(mailTo(KARIM, "Reset your CityCare password"));

        expect(token).not.toBe(resetToken);
        await prisma.user.update({ where: { id: karimId }, data: { resetTokenExpiresAt: new Date(Date.now() - 60 * 1000) } });

        const res = await http().post("/auth/reset-password", { token, newPassword: "another123" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "token")).toBe(true);
    });

    it("sends no reset email to a blocked user", async () => {
        await prisma.user.update({ where: { id: karimId }, data: { status: "BLOCKED" } });

        const before = mailTest.outbox.length;

        expect((await http().post("/auth/forgot-password", { email: KARIM })).status).toBe(200);
        expect(mailTest.outbox).toHaveLength(before);
        await prisma.user.update({ where: { id: karimId }, data: { status: "ACTIVE" } });
    });

    it("records the reset in the audit log", async () => {
        const logs = await prisma.auditLog.findMany({ where: { action: "PASSWORD_RESET" } });

        expect(logs).toHaveLength(1);
        expect(logs[0]).toMatchObject({ actorId: karimId, entityType: "USER", entityId: karimId });
    });
});

describe("staff account email", () => {
    it("tells a new staff member about the account without the password", async () => {
        const res = await http(admin.token).post("/admin/users", {
            name: "Waste Staff",
            email: STAFF,
            password: "staff12345",
            role: "STAFF",
            departmentId: wasteId,
        });

        expect(res.status).toBe(201);

        const mail = mailTo(STAFF, "Your CityCare account was created");

        expect(mail.html).toContain("Waste Management");
        expect(mail.html).not.toContain("staff12345");
        staffToken = (await login(STAFF, "staff12345")).accessToken;
    });
});

describe("complaint emails", () => {
    it("confirms a new complaint with its tracking code and escapes the title", async () => {
        const res = await http(karimToken).post(
            "/complaints",
            complaintBody(garbageId, { title: "Garbage <script>alert(1)</script> pile" })
        );

        expect(res.status).toBe(201);
        complaint = res.body.data;

        const mail = mailTo(KARIM, "We received your complaint");

        expect(mail.subject).toContain(complaint.trackingCode);
        expect(mail.html).toContain(complaint.trackingCode);
        expect(mail.html).toContain("&lt;script&gt;");
        expect(mail.html).not.toContain("<script>");
    });

    it("tells the citizen and the staff member about the assignment", async () => {
        expect((await http(admin.token).post(`/complaints/${complaint.id}/assign`, {})).status).toBe(200);
        expect(mailTo(KARIM, "A staff member is working on your complaint").html).toContain("Waste Staff");
        expect(mailTo(STAFF, "New complaint assigned to you").html).toContain("MEDIUM");
    });

    it("sends nothing for the in progress step", async () => {
        const before = mailTest.outbox.length;

        expect((await setStatus(staffToken, complaint.id, { status: "IN_PROGRESS" })).status).toBe(200);
        expect(mailTest.outbox).toHaveLength(before);
    });

    it("sends the staff note with the resolved email", async () => {
        const res = await setStatus(staffToken, complaint.id, { status: "RESOLVED", note: "The pile was removed this morning." });

        expect(res.status).toBe(200);
        expect(mailTo(KARIM, "Your complaint was resolved").html).toContain("removed this morning");
    });

    it("sends the reason with the rejected email", async () => {
        const second = await http(karimToken).post("/complaints", complaintBody(garbageId, { title: "Another garbage pile on road 9" }));

        expect(second.status).toBe(201);

        const res = await setStatus(admin.token, second.body.data.id, {
            status: "REJECTED",
            note: "This is a duplicate of an older complaint.",
        });
        const mail = mailTo(KARIM, "Your complaint was rejected");

        expect(res.status).toBe(200);
        expect(mail.subject).toContain(second.body.data.trackingCode);
        expect(mail.html).toContain("duplicate of an older complaint");
        expect(mail.html).not.toContain("refunded");
    });
});

describe("payment emails", () => {
    it("asks for the service fee of a paid request", async () => {
        const res = await http(karimToken).post("/complaints", complaintBody(bulkId, { title: "Old sofa pickup from my house" }));

        expect(res.status).toBe(201);
        paid = res.body.data;

        const mail = mailTo(KARIM, "Payment needed");

        expect(mail.subject).toContain(paid.trackingCode);
        expect(mail.html).toContain("USD 15.00");
    });

    it("confirms the payment once even when the webhook comes twice", async () => {
        const initiated = await http(karimToken).post("/payments/initiate", { complaintId: paid.id });

        expect(initiated.status).toBe(201);

        const session = stripeTest.pay(initiated.body.data.payment.transactionId);
        const { payload, signature } = stripeTest.signedEvent("checkout.session.completed", session);
        const webhook = () => {
            return http(undefined, { "stripe-signature": signature })
                .upload("/payments/webhook")
                .set("Content-Type", "application/json")
                .send(payload);
        };

        expect((await webhook()).status).toBe(200);
        expect((await webhook()).status).toBe(200);

        const received = mailTest.sentTo(KARIM).filter((mail) => mail.subject.includes("Payment received"));

        expect(received).toHaveLength(1);
        expect(received[0]?.subject).toContain(paid.trackingCode);
        expect(received[0]?.html).toContain("USD 15.00");
    });
});

describe("email that cannot be sent", () => {
    beforeAll(() => {
        mailTest.fail();
    });

    afterAll(() => {
        mailTest.fail(false);
    });

    it("still registers the user", async () => {
        const res = await http().post("/auth/register", { name: "No Mail User", email: "nomail@test.com", password: "secret123" });

        expect(res.status).toBe(201);
        expect(sendEmail).toHaveBeenLastCalledWith(expect.objectContaining({ to: "nomail@test.com", subject: "Welcome to CityCare" }));
        expect(mailTest.sentTo("nomail@test.com")).toHaveLength(0);
    });

    it("returns the reset token outside production so the reset still works", async () => {
        const res = await http().post("/auth/forgot-password", { email: "nomail@test.com" });

        expect(res.status).toBe(200);
        expect(res.body.data.resetToken).toMatch(/^[a-f0-9]{64}$/);
        expect((await http().post("/auth/reset-password", { token: res.body.data.resetToken, newPassword: "freshpass1" })).status).toBe(
            200
        );
        expect((await login("nomail@test.com", "freshpass1")).accessToken).toEqual(expect.any(String));
    });

    it("still returns no token for an unknown email", async () => {
        const res = await http().post("/auth/forgot-password", { email: "nobody@test.com" });

        expect(res.status).toBe(200);
        expect(res.body.data).toBeNull();
    });
});

describe("in production", () => {
    let production: Application;
    let close: () => Promise<void>;

    beforeAll(async () => {
        vi.stubEnv("NODE_ENV", "production");
        vi.doMock("dotenv", () => ({ default: { config: vi.fn() } }));
        vi.resetModules();
        production = (await import("../../src/app")).default;

        const { default: productionPrisma } = await import("../../src/lib/prisma");
        const { default: getRedis } = await import("../../src/lib/redis");

        close = async () => {
            await productionPrisma.$disconnect();
            getRedis()?.disconnect();
        };
        mailTest.fail();
    });

    afterAll(async () => {
        mailTest.fail(false);
        await close();
        vi.doUnmock("dotenv");
        vi.unstubAllEnvs();
    });

    it("never returns the reset token, even when the email cannot be sent", async () => {
        const res = await request(production).post("/api/v1/auth/forgot-password").send({ email: "nomail@test.com" });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, data: null });
        expect(sendEmail).toHaveBeenLastCalledWith(
            expect.objectContaining({ to: "nomail@test.com", subject: "Reset your CityCare password" })
        );
        expect(mailTest.sentTo("nomail@test.com")).toHaveLength(0);
    });
});
