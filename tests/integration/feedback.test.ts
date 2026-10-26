import { beforeAll, describe, expect, it } from "vitest";
import { ComplaintStatus } from "../../src/generated/prisma/client";
import { prisma, resetDatabase } from "../helpers/db";
import { createCity, type ITestUser, moveStatus, resolveComplaint, submitComplaint } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

interface IComplaint {
    id: string;
}

let admin: ITestUser;
let citizen: ITestUser;
let citizen2: ITestUser;
let roadsStaff: ITestUser;
let pothole: { id: string };
let first: IComplaint;
let second: IComplaint;
let third: IComplaint;

const feedback = (token: string | undefined, complaintId: string, body: object) =>
    http(token).post(`/complaints/${complaintId}/feedback`, body);

beforeAll(async () => {
    await resetDatabase();
    ({ admin, citizen, citizen2, roadsStaff, pothole } = await createCity());
    first = await submitComplaint(citizen, pothole.id);
});

describe("feedback", () => {
    it("waits until the complaint is resolved", async () => {
        expect((await feedback(citizen.token, first.id, { rating: 5 })).status).toBe(409);
    });

    it("can be given only by the citizen who owns the complaint", async () => {
        await resolveComplaint(admin, roadsStaff, first.id);

        expect((await feedback(undefined, first.id, { rating: 5 })).status).toBe(401);
        expect((await feedback(roadsStaff.token, first.id, { rating: 5 })).status).toBe(403);
        expect((await feedback(citizen2.token, first.id, { rating: 5 })).status).toBe(403);
    });

    it("needs a whole number rating from 1 to 5", async () => {
        for (const rating of [0, 6, 2.5, "5"]) {
            const res = await feedback(citizen.token, first.id, { rating });

            expect(res.status, String(rating)).toBe(400);
            expect(hasFieldError(res, "rating"), String(rating)).toBe(true);
        }
    });

    it("closes a resolved complaint with the rating on the timeline", async () => {
        const res = await feedback(citizen.token, first.id, { rating: 4, comment: "Fixed quickly, thank you." });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ status: "CLOSED", feedback: { rating: 4, comment: "Fixed quickly, thank you." } });
        expect(res.body.data.closedAt).not.toBeNull();
        expect(res.body.data.updates.at(-1)).toMatchObject({
            fromStatus: "RESOLVED",
            toStatus: "CLOSED",
            note: "Closed by the citizen with a 4 star rating",
            actor: { id: citizen.id },
        });
    });

    it("can be given only once and leaves the complaint closed for good", async () => {
        expect((await feedback(citizen.token, first.id, { rating: 1 })).status).toBe(409);
        expect(
            (await http(citizen.token).post(`/complaints/${first.id}/reopen`, { reason: "Trying to reopen a closed complaint." })).status
        ).toBe(409);
    });

    it("is accepted on a complaint the admin already closed", async () => {
        second = await submitComplaint(citizen, pothole.id);
        await resolveComplaint(admin, roadsStaff, second.id);

        const closed = await moveStatus(admin, second.id, "CLOSED");
        const res = await feedback(citizen.token, second.id, { rating: 2 });

        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ status: "CLOSED", feedback: { rating: 2, comment: null } });
        expect(res.body.data.updates).toHaveLength(closed.updates.length);
    });

    it("is saved once when five requests arrive in parallel", async () => {
        third = await submitComplaint(citizen, pothole.id);
        await resolveComplaint(admin, roadsStaff, third.id);

        const results = await Promise.all(Array.from({ length: 5 }, () => feedback(citizen.token, third.id, { rating: 3 })));
        const statuses = results.map((res) => res.status);

        expect(
            statuses.filter((status) => status === 201),
            String(statuses)
        ).toHaveLength(1);
        expect(
            statuses.filter((status) => status === 409),
            String(statuses)
        ).toHaveLength(4);
        expect(await prisma.feedback.count({ where: { complaintId: third.id } })).toBe(1);
        expect(await prisma.complaintUpdate.count({ where: { complaintId: third.id, toStatus: ComplaintStatus.CLOSED } })).toBe(1);
    });

    it("is limited to 1 to 5 stars by the database too", async () => {
        const fourth = await submitComplaint(citizen, pothole.id);

        await expect(prisma.feedback.create({ data: { complaintId: fourth.id, citizenId: citizen.id, rating: 9 } })).rejects.toThrow(
            /feedbacks_rating_check/
        );
        expect(await prisma.feedback.count({ where: { complaintId: fourth.id } })).toBe(0);
    });

    it("is shown to the assigned staff member", async () => {
        const res = await http(roadsStaff.token).get(`/complaints/${first.id}`);

        expect(res.status).toBe(200);
        expect(res.body.data.feedback).toMatchObject({ rating: 4, comment: "Fixed quickly, thank you." });
    });

    it("is recorded in the audit trail once per complaint", async () => {
        const logs = await prisma.auditLog.findMany({ where: { action: "FEEDBACK_SUBMITTED" }, orderBy: { createdAt: "asc" } });

        expect(logs.map((log) => ({ actorId: log.actorId, entityId: log.entityId, metadata: log.metadata }))).toEqual([
            { actorId: citizen.id, entityId: first.id, metadata: { rating: 4 } },
            { actorId: citizen.id, entityId: second.id, metadata: { rating: 2 } },
            { actorId: citizen.id, entityId: third.id, metadata: { rating: 3 } },
        ]);
    });
});
