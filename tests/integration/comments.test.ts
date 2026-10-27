import { beforeAll, describe, expect, it } from "vitest";
import { Role } from "../../src/generated/prisma/client";
import { prisma, resetDatabase } from "../helpers/db";
import { assignTo, createCity, createUser, type ITestUser, MISSING_ID, submitComplaint } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

type TCity = Awaited<ReturnType<typeof createCity>>;

let city: TCity;
let secondAdmin: ITestUser;
let complaint: { id: string; trackingCode: string };
let citizenMessage: { id: string };
let staffNote: { id: string };

const path = (id = complaint.id) => `/complaints/${id}/comments`;

const notificationsOf = (user: { id: string }) => prisma.notification.findMany({ where: { userId: user.id, type: "COMMENT_ADDED" } });

beforeAll(async () => {
    await resetDatabase();
    city = await createCity();
    secondAdmin = await createUser({ role: Role.ADMIN, name: "Second Admin" });
    complaint = await submitComplaint(city.citizen, city.pothole.id, { title: "Deep pothole near the mosque" });
    await assignTo(city.admin, complaint.id, city.roadsStaff.id);
});

describe("who can join the conversation", () => {
    it("needs a login and access to the complaint", async () => {
        expect((await http().get(path())).status).toBe(401);
        expect((await http(city.citizen2.token).get(path())).status).toBe(403);
        expect((await http(city.roadsStaff2.token).post(path(), { body: "Can I help with this one?" })).status).toBe(403);
        expect((await http(city.citizen.token).get(path(MISSING_ID))).status).toBe(404);
    });

    it("lets the owner, the assigned staff member and admins read it", async () => {
        for (const user of [city.citizen, city.roadsStaff, city.admin]) {
            const res = await http(user.token).get(path());

            expect(res.status, user.name).toBe(200);
            expect(res.body.data).toEqual([]);
        }
    });
});

describe("messages", () => {
    it("validates the message", async () => {
        const short = await http(city.citizen.token).post(path(), { body: " a " });
        const flag = await http(city.roadsStaff.token).post(path(), { body: "Looks fine", internal: "yes" });

        expect(short.status).toBe(400);
        expect(hasFieldError(short, "body")).toBe(true);
        expect(flag.status).toBe(400);
        expect(hasFieldError(flag, "internal")).toBe(true);
    });

    it("sends a citizen message and tells the staff member, not the citizen", async () => {
        const res = await http(city.citizen.token).post(path(), { body: "The hole got bigger after last night's rain." });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({
            body: "The hole got bigger after last night's rain.",
            isInternal: false,
            author: { id: city.citizen.id, name: "Citizen One", role: "CITIZEN" },
        });
        citizenMessage = res.body.data;
        expect(await notificationsOf(city.roadsStaff)).toEqual([
            expect.objectContaining({ title: "New message on a report", body: expect.stringContaining("got bigger") }),
        ]);
        expect(await notificationsOf(city.citizen)).toEqual([]);
    });

    it("does not let a citizen write an internal note", async () => {
        expect((await http(city.citizen.token).post(path(), { body: "Secret note", internal: true })).status).toBe(403);
    });

    it("tells the citizen about a reply from the staff member", async () => {
        const res = await http(city.roadsStaff.token).post(path(), { body: "We will fill it tomorrow morning." });

        expect(res.status).toBe(201);
        expect(await notificationsOf(city.citizen)).toHaveLength(1);
    });

    it("keeps an internal note away from the citizen", async () => {
        const res = await http(city.roadsStaff.token).post(path(), {
            body: "Needs a second crew, the asphalt truck is busy.",
            internal: true,
        });

        expect(res.status).toBe(201);
        expect(res.body.message).toBe("Internal note added");
        staffNote = res.body.data;
        expect(await notificationsOf(city.citizen)).toHaveLength(1);

        const citizenView = await http(city.citizen.token).get(path());
        const staffView = await http(city.roadsStaff.token).get(path());
        const adminView = await http(city.admin.token).get(path());

        expect(citizenView.body.data.map((item: { id: string }) => item.id)).not.toContain(staffNote.id);
        expect(citizenView.body.data).toHaveLength(2);
        expect(staffView.body.data).toHaveLength(3);
        expect(adminView.body.data.map((item: { isInternal: boolean }) => item.isInternal)).toEqual([false, false, true]);
    });

    it("tells the staff member about an admin note", async () => {
        const before = (await notificationsOf(city.roadsStaff)).length;

        await http(city.admin.token).post(path(), { body: "Second crew is booked for 9 am.", internal: true });

        expect(await notificationsOf(city.roadsStaff)).toHaveLength(before + 1);
    });

    it("tells every admin when nobody is assigned yet", async () => {
        const waiting = await submitComplaint(city.citizen2, city.light.id, { title: "Dark street near the market" });

        await http(city.citizen2.token).post(path(waiting.id), { body: "Nobody has come yet, it is very dark." });

        expect(await notificationsOf(city.admin)).toHaveLength(1);
        expect(await notificationsOf(secondAdmin)).toHaveLength(1);
    });
});

describe("removing messages", () => {
    it("lets only the author or an admin remove a message", async () => {
        expect((await http(city.roadsStaff.token).delete(`${path()}/${citizenMessage.id}`)).status).toBe(403);
        expect((await http(city.citizen.token).delete(`${path()}/${staffNote.id}`)).status).toBe(404);
        expect((await http(city.citizen2.token).delete(`${path()}/${citizenMessage.id}`)).status).toBe(403);
        expect((await http(city.citizen.token).delete(`${path()}/not-an-id`)).status).toBe(400);
    });

    it("lets the author remove a message within 15 minutes", async () => {
        const res = await http(city.citizen.token).delete(`${path()}/${citizenMessage.id}`);

        expect(res.status).toBe(200);
        expect((await http(city.citizen.token).get(path())).body.data.map((item: { id: string }) => item.id)).not.toContain(
            citizenMessage.id
        );
        expect((await http(city.citizen.token).delete(`${path()}/${citizenMessage.id}`)).status).toBe(404);
        expect(await prisma.complaintComment.findUniqueOrThrow({ where: { id: citizenMessage.id } })).toMatchObject({
            deletedAt: expect.any(Date),
        });
    });

    it("keeps older messages unless an admin removes them", async () => {
        await prisma.complaintComment.update({ where: { id: staffNote.id }, data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) } });

        expect((await http(city.roadsStaff.token).delete(`${path()}/${staffNote.id}`)).status).toBe(409);
        expect((await http(city.admin.token).delete(`${path()}/${staffNote.id}`)).status).toBe(200);
    });

    it("writes an audit row for each removal", async () => {
        const logs = await prisma.auditLog.findMany({ where: { action: "COMMENT_REMOVED" }, orderBy: { createdAt: "asc" } });

        expect(logs.map((log) => [log.actorId, (log.metadata as { commentId: string }).commentId])).toEqual([
            [city.citizen.id, citizenMessage.id],
            [city.admin.id, staffNote.id],
        ]);
    });

    it("hides the conversation of a removed complaint", async () => {
        await prisma.complaint.update({ where: { id: complaint.id }, data: { deletedAt: new Date() } });

        expect((await http(city.admin.token).get(path())).status).toBe(404);
    });
});
