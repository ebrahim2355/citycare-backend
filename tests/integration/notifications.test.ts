import { beforeAll, describe, expect, it } from "vitest";
import { Role, UserStatus } from "../../src/generated/prisma/client";
import { stripeTest } from "../fakes/stripe";
import { prisma, resetDatabase } from "../helpers/db";
import { assignTo, createCity, createUser, type ITestUser, MISSING_ID, moveStatus, submitComplaint } from "../helpers/factories";
import { http } from "../helpers/http";

type TCity = Awaited<ReturnType<typeof createCity>>;

let city: TCity;
let secondAdmin: ITestUser;
let blockedAdmin: ITestUser;
let complaint: { id: string; trackingCode: string };

const inboxOf = (user: { id: string }) => {
    return prisma.notification.findMany({ where: { userId: user.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
};

const latestOf = async (user: { id: string }) => (await inboxOf(user)).at(-1);

const countOf = (user: { id: string }) => prisma.notification.count({ where: { userId: user.id } });

beforeAll(async () => {
    await resetDatabase();
    city = await createCity();
    secondAdmin = await createUser({ role: Role.ADMIN, name: "Second Admin" });
    blockedAdmin = await createUser({ role: Role.ADMIN, name: "Blocked Admin", status: UserStatus.BLOCKED });
});

describe("who is told about each step", () => {
    it("tells every active admin about a new complaint", async () => {
        complaint = await submitComplaint(city.citizen, city.pothole.id, { title: "Open manhole on the main road" });

        for (const admin of [city.admin, secondAdmin]) {
            expect(await latestOf(admin)).toMatchObject({
                type: "COMPLAINT_SUBMITTED",
                title: "New complaint",
                complaintId: complaint.id,
                body: expect.stringContaining(complaint.trackingCode),
            });
        }

        expect(await countOf(blockedAdmin)).toBe(0);
        expect(await countOf(city.citizen)).toBe(0);
    });

    it("tells the citizen and the staff member about an assignment, but not the admin who did it", async () => {
        const before = await countOf(city.admin);

        await assignTo(city.admin, complaint.id, city.roadsStaff.id);

        expect(await latestOf(city.citizen)).toMatchObject({
            type: "COMPLAINT_ASSIGNED",
            body: expect.stringContaining("Staff One"),
        });
        expect(await latestOf(city.roadsStaff)).toMatchObject({ type: "COMPLAINT_ASSIGNED", title: "New job for you" });
        expect(await countOf(city.admin)).toBe(before);
    });

    it("tells the previous staff member when the job moves to a colleague", async () => {
        await assignTo(city.admin, complaint.id, city.roadsStaff2.id);

        expect(await latestOf(city.roadsStaff)).toMatchObject({
            type: "COMPLAINT_UNASSIGNED",
            body: expect.stringContaining("Staff Two"),
        });
        expect(await latestOf(city.roadsStaff2)).toMatchObject({ type: "COMPLAINT_ASSIGNED" });
    });

    it("tells the citizen when work starts and when it is resolved, never the staff member who acted", async () => {
        const staffBefore = await countOf(city.roadsStaff2);

        await moveStatus(city.roadsStaff2, complaint.id, "IN_PROGRESS");
        expect(await latestOf(city.citizen)).toMatchObject({ type: "COMPLAINT_STATUS_CHANGED", title: "Work has started" });

        await moveStatus(city.roadsStaff2, complaint.id, "RESOLVED", "Cover replaced and road marked.");
        expect(await latestOf(city.citizen)).toMatchObject({ type: "COMPLAINT_STATUS_CHANGED", title: "Your report was resolved" });
        expect(await countOf(city.roadsStaff2)).toBe(staffBefore);
    });

    it("tells the staff member about the rating", async () => {
        const res = await http(city.citizen.token).post(`/complaints/${complaint.id}/feedback`, {
            rating: 5,
            comment: "Quick and tidy work",
        });

        expect(res.status).toBe(201);
        expect(await latestOf(city.roadsStaff2)).toMatchObject({
            type: "FEEDBACK_RECEIVED",
            title: "You received a 5 star rating",
            body: expect.stringContaining("Quick and tidy work"),
        });
    });

    it("tells the staff member when a resolved report is reopened", async () => {
        const second = await submitComplaint(city.citizen, city.light.id, { title: "Street light blinking all night" });

        await assignTo(city.admin, second.id, city.roadsStaff.id);
        await moveStatus(city.roadsStaff, second.id, "IN_PROGRESS");
        await moveStatus(city.roadsStaff, second.id, "RESOLVED", "Bulb replaced.");

        const res = await http(city.citizen.token).post(`/complaints/${second.id}/reopen`, {
            reason: "It started blinking again tonight.",
        });

        expect(res.status).toBe(200);
        expect(await latestOf(city.roadsStaff)).toMatchObject({
            type: "COMPLAINT_REOPENED",
            body: expect.stringContaining("It started blinking again tonight."),
        });
    });

    it("tells the citizen and the staff member about a rejection with the reason", async () => {
        const third = await submitComplaint(city.citizen2, city.pothole.id, { title: "Hole in the private driveway" });

        await assignTo(city.admin, third.id, city.roadsStaff.id);

        const res = await http(city.admin.token).patch(`/complaints/${third.id}/status`, {
            status: "REJECTED",
            note: "The driveway is private property.",
        });

        expect(res.status).toBe(200);
        expect(await latestOf(city.citizen2)).toMatchObject({
            title: "Your report was rejected",
            body: expect.stringContaining("The driveway is private property."),
        });
        expect(await latestOf(city.roadsStaff)).toMatchObject({ title: "Job closed by the city team" });
    });

    it("tells the citizen and the old staff member about a transfer", async () => {
        const fourth = await submitComplaint(city.citizen2, city.pothole.id, { title: "Garbage dumped in the pothole" });

        await assignTo(city.admin, fourth.id, city.roadsStaff2.id);

        const res = await http(city.admin.token).post(`/complaints/${fourth.id}/transfer`, { departmentId: city.waste.id });

        expect(res.status).toBe(200);
        expect(await latestOf(city.citizen2)).toMatchObject({
            type: "COMPLAINT_TRANSFERRED",
            body: expect.stringContaining("Waste Management"),
        });
        expect(await latestOf(city.roadsStaff2)).toMatchObject({ type: "COMPLAINT_UNASSIGNED", title: "Job moved to another department" });
    });

    it("tells the citizen and the admins about a paid request and the citizen about its refund", async () => {
        const adminsBefore = await countOf(city.admin);
        const request = await submitComplaint(city.citizen, city.bulk.id, { title: "Old sofa and fridge pickup" });

        expect(await countOf(city.admin)).toBe(adminsBefore);

        const initiated = await http(city.citizen.token).post("/payments/initiate", { complaintId: request.id });
        const sessionId = initiated.body.data.payment.transactionId;

        stripeTest.pay(sessionId);
        expect((await http(city.citizen.token).post("/payments/verify", { sessionId })).status).toBe(200);
        expect(await latestOf(city.citizen)).toMatchObject({ type: "PAYMENT_RECEIVED", complaintId: request.id });
        expect(await latestOf(city.admin)).toMatchObject({ type: "COMPLAINT_SUBMITTED", title: "New paid request" });

        await http(city.admin.token).patch(`/complaints/${request.id}/status`, { status: "REJECTED", note: "No truck this week." });

        const citizenInbox = await inboxOf(city.citizen);

        expect(citizenInbox.map((item) => item.type)).toEqual(expect.arrayContaining(["PAYMENT_REFUNDED"]));
    });
});

describe("the inbox API", () => {
    it("needs a login", async () => {
        expect((await http().get("/notifications")).status).toBe(401);
    });

    it("lists only the user's own notifications, newest first, with the complaint", async () => {
        const res = await http(city.roadsStaff.token).get("/notifications?limit=50");
        const own = await inboxOf(city.roadsStaff);

        expect(res.status).toBe(200);
        expect(res.body.meta.total).toBe(own.length);
        expect(res.body.data.map((item: { id: string }) => item.id)).toEqual(own.map((item) => item.id).reverse());
        expect(res.body.data[0]).toEqual(
            expect.objectContaining({ readAt: null, complaint: expect.objectContaining({ trackingCode: expect.stringMatching(/^CC-/) }) })
        );
    });

    it("counts, reads one and reads the rest", async () => {
        const total = await countOf(city.roadsStaff);
        const first = (await http(city.roadsStaff.token).get("/notifications")).body.data[0];

        expect((await http(city.roadsStaff.token).get("/notifications/unread-count")).body.data).toEqual({ count: total });

        const read = await http(city.roadsStaff.token).patch(`/notifications/${first.id}/read`);

        expect(read.status).toBe(200);
        expect(read.body.data.readAt).not.toBeNull();
        expect((await http(city.roadsStaff.token).patch(`/notifications/${first.id}/read`)).body.data.readAt).toBe(read.body.data.readAt);
        expect((await http(city.roadsStaff.token).get("/notifications?unread=true")).body.meta.total).toBe(total - 1);

        const all = await http(city.roadsStaff.token).patch("/notifications/read-all");

        expect(all.body.data).toEqual({ count: total - 1 });
        expect((await http(city.roadsStaff.token).get("/notifications/unread-count")).body.data).toEqual({ count: 0 });
    });

    it("never lets a user read someone else's notification", async () => {
        const citizenNotification = await latestOf(city.citizen);
        const res = await http(city.roadsStaff.token).patch(`/notifications/${citizenNotification?.id}/read`);

        expect(res.status).toBe(404);
        expect((await prisma.notification.findUniqueOrThrow({ where: { id: citizenNotification?.id } })).readAt).toBeNull();
    });

    it("validates the query and the id", async () => {
        expect((await http(city.citizen.token).get("/notifications?unread=maybe")).status).toBe(400);
        expect((await http(city.citizen.token).patch("/notifications/not-an-id/read")).status).toBe(400);
        expect((await http(city.citizen.token).patch(`/notifications/${MISSING_ID}/read`)).status).toBe(404);
    });

    it("removes a user's notifications together with the user", async () => {
        const user = await createUser({ role: Role.STAFF, departmentId: city.roads.id });
        const fresh = await submitComplaint(city.citizen, city.pothole.id, { title: "Cracked kerb at the crossing" });

        await assignTo(city.admin, fresh.id, user.id);
        expect(await countOf(user)).toBe(1);

        await prisma.user.delete({ where: { id: user.id } });
        expect(await countOf(user)).toBe(0);
    });
});
