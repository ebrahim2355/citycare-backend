import { beforeAll, describe, expect, it } from "vitest";
import config from "../../src/config";
import { Role } from "../../src/generated/prisma/client";
import getRedis from "../../src/lib/redis";
import { mailTest } from "../fakes/mailer";
import { prisma, resetDatabase } from "../helpers/db";
import { createUser, type ITestUser } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

let admin: ITestUser;
let citizen: ITestUser;
let refundQuestionId: string;
let generalQuestionId: string;

beforeAll(async () => {
    await resetDatabase();
    admin = await createUser({ role: Role.ADMIN, name: "City Admin" });
    citizen = await createUser({ name: "Karim Citizen" });
});

describe("contact form", () => {
    it("validates the fields", async () => {
        const res = await http().post("/contact", { name: "K", email: "bad", subject: "Hi", message: "short" });

        expect(res.status).toBe(400);
        for (const field of ["name", "email", "subject", "message"]) {
            expect(hasFieldError(res, field), field).toBe(true);
        }
    });

    it("saves a message and answers with safe fields only", async () => {
        const res = await http().post("/contact", {
            name: "Rina Das",
            email: "Rina@Example.com",
            topic: "PAYMENT",
            subject: "Refund question",
            message: "I paid for a septic tank cleaning twice by mistake.",
        });

        expect(res.status).toBe(201);
        expect(Object.keys(res.body.data).sort()).toEqual(["createdAt", "id", "subject", "topic"]);
        expect(res.body.data.topic).toBe("PAYMENT");
        refundQuestionId = res.body.data.id;
        expect(await prisma.contactMessage.findUniqueOrThrow({ where: { id: refundQuestionId } })).toMatchObject({
            email: "rina@example.com",
            status: "NEW",
        });
    });

    it("thanks the sender by email", () => {
        expect(mailTest.sentTo("rina@example.com").map((email) => email.subject)).toEqual(["We got your message: Refund question"]);
    });

    it("uses GENERAL as the default topic", async () => {
        const res = await http().post("/contact", {
            name: "Rina Das",
            email: "rina@example.com",
            subject: "Second",
            message: "Default topic should be general.",
        });

        expect(res.status).toBe(201);
        expect(res.body.data.topic).toBe("GENERAL");
        generalQuestionId = res.body.data.id;
    });
});

describe("admin inbox", () => {
    it("is only for admins", async () => {
        expect((await http().get("/admin/messages")).status).toBe(401);
        expect((await http(citizen.token).get("/admin/messages")).status).toBe(403);
    });

    it("lists new messages, newest first", async () => {
        const res = await http(admin.token).get("/admin/messages");
        const messages: { id: string; status: string; createdAt: string }[] = res.body.data;
        const createdAt = messages.map((item) => item.createdAt);

        expect(res.status).toBe(200);
        expect(res.body.meta.total).toBe(2);
        expect(messages.map((item) => item.id).sort()).toEqual([generalQuestionId, refundQuestionId].sort());
        expect(createdAt).toEqual([...createdAt].sort().reverse());
        expect(messages.every((item) => item.status === "NEW")).toBe(true);
    });

    it("filters by topic and search term", async () => {
        const res = await http(admin.token).get("/admin/messages?topic=PAYMENT&searchTerm=septic");

        expect(res.body.meta.total).toBe(1);
        expect(res.body.data[0].id).toBe(refundQuestionId);
    });

    it("validates the reply", async () => {
        const res = await http(admin.token).post(`/admin/messages/${refundQuestionId}/reply`, { reply: "short" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "reply")).toBe(true);
    });

    it("emails the reply and marks the message REPLIED", async () => {
        const res = await http(admin.token).post(`/admin/messages/${refundQuestionId}/reply`, {
            reply: "We checked it. The second payment was refunded today.\nThank you.",
        });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            emailSent: true,
            message: { status: "REPLIED", repliedBy: { id: admin.id, name: "City Admin" } },
        });

        const replyMail = mailTest.sentTo("rina@example.com").find((email) => email.subject === "Re: Refund question");

        expect(replyMail?.html).toContain("refunded today.<br />Thank you.");
    });

    it("closes a message only once", async () => {
        const res = await http(admin.token).patch(`/admin/messages/${refundQuestionId}/status`, { status: "CLOSED" });

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("CLOSED");
        expect((await http(admin.token).patch(`/admin/messages/${refundQuestionId}/status`, { status: "CLOSED" })).status).toBe(409);
        expect((await http(admin.token).get("/admin/messages?status=CLOSED")).body.meta.total).toBe(1);
    });

    it("audits the reply and the status change", async () => {
        const res = await http(admin.token).get("/admin/audit-logs?entityType=MESSAGE&sortOrder=asc");

        expect(res.body.meta.total).toBe(2);
        expect(res.body.data.map((item: { action: string }) => item.action)).toEqual(["MESSAGE_REPLIED", "MESSAGE_STATUS_CHANGED"]);
    });
});

describe("email that cannot be sent", () => {
    it("still saves the message from the contact form", async () => {
        mailTest.fail();

        const res = await http().post("/contact", {
            name: "Demo User",
            email: "someone@citycare.com",
            subject: "Mail is down",
            message: "This message must be saved without an email.",
        });

        mailTest.fail(false);
        expect(res.status).toBe(201);
        expect(await prisma.contactMessage.count({ where: { id: res.body.data.id } })).toBe(1);
        expect(mailTest.sentTo("someone@citycare.com")).toHaveLength(0);
    });

    it("still saves the reply and says the email failed", async () => {
        mailTest.fail();

        const res = await http(admin.token).post(`/admin/messages/${generalQuestionId}/reply`, {
            reply: "Thank you, we filed this under general questions.",
        });

        mailTest.fail(false);
        expect(res.status).toBe(200);
        expect(res.body.message).toBe("Reply saved, but the email could not be sent");
        expect(res.body.data).toMatchObject({ emailSent: false, message: { status: "REPLIED" } });
        expect(mailTest.sentTo("rina@example.com").some((email) => email.subject === "Re: Second")).toBe(false);
    });
});

describe("rate limit", () => {
    it("answers 429 once a client reaches the contact form limit", async () => {
        const redis = getRedis();
        const keys = (await redis?.keys("citycare:ratelimit:contact:*")) ?? [];

        expect(keys).toHaveLength(1);

        for (const key of keys) {
            await redis?.set(key, String(config.rateLimit.authMax), "PX", 60000);
        }

        const res = await http().post("/contact", {
            name: "Spam Bot",
            email: "bot@example.com",
            subject: "Buy now",
            message: "Spam spam spam spam spam.",
        });

        expect(res.status).toBe(429);
        expect(res.body.message).toBe("Too many requests");
        expect(await prisma.contactMessage.count({ where: { email: "bot@example.com" } })).toBe(0);
        expect((await http().get("/departments")).status).toBe(200);
    });
});
