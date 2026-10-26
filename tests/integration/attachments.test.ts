import { beforeAll, describe, expect, it } from "vitest";
import { cloudinaryTest } from "../fakes/cloudinary";
import { prisma, resetDatabase } from "../helpers/db";
import { assignTo, createCity, type ITestUser, MISSING_ID, moveStatus, submitComplaint } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

interface IComplaint {
    id: string;
    trackingCode: string;
}

interface IAttachment {
    id: string;
    uploadedBy: { id: string };
}

type TFile = [filename: string, content: Buffer, contentType: string];

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const jpg = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);
const webp = Buffer.from("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==", "base64");

let admin: ITestUser;
let citizen: ITestUser;
let citizen2: ITestUser;
let roadsStaff: ITestUser;
let roadsStaff2: ITestUser;
let pothole: { id: string };
let complaint: IComplaint;
let second: IComplaint;
let third: IComplaint;
let fourth: IComplaint;
let firstImage: IAttachment;
let proof: IAttachment;

const pngFile = (filename = "a.png"): TFile => [filename, png, "image/png"];

const upload = (user: ITestUser | null, complaintId: string, files: TFile[], field = "images") => {
    const req = http(user?.token).upload(`/complaints/${complaintId}/attachments`);

    for (const [filename, content, contentType] of files) {
        req.attach(field, content, { filename, contentType });
    }

    return req;
};

const removeImage = (user: ITestUser, complaintId: string, attachmentId: string) =>
    http(user.token).delete(`/complaints/${complaintId}/attachments/${attachmentId}`);

const folderOf = (target: IComplaint) => `citycare/complaints/${target.trackingCode}`;

const storedIn = (target: IComplaint) =>
    cloudinaryTest.stored.filter((image) => image.folder === folderOf(target)).map((image) => image.publicId);

const destroyedIn = (target: IComplaint) => cloudinaryTest.destroyed.filter((publicId) => publicId.startsWith(`${folderOf(target)}/`));

const savedCount = (complaintId: string) => prisma.complaintAttachment.count({ where: { complaintId, deletedAt: null } });

beforeAll(async () => {
    await resetDatabase();
    ({ admin, citizen, citizen2, roadsStaff, roadsStaff2, pothole } = await createCity());
    complaint = await submitComplaint(citizen, pothole.id);
});

describe("upload", () => {
    it("needs a login and sends nothing to Cloudinary without one", async () => {
        expect((await upload(null, complaint.id, [pngFile()])).status).toBe(401);
        expect(cloudinaryTest.stored).toHaveLength(0);
    });

    it("is refused on another citizen's complaint and for staff who are not assigned", async () => {
        expect((await upload(citizen2, complaint.id, [pngFile()])).status).toBe(403);
        expect((await upload(roadsStaff, complaint.id, [pngFile()])).status).toBe(403);
    });

    it("needs at least one file in the images field", async () => {
        const noFile = await http(citizen.token).upload(`/complaints/${complaint.id}/attachments`).field("note", "no image here");
        const jsonBody = await http(citizen.token).post(`/complaints/${complaint.id}/attachments`, { images: "nope" });
        const wrongField = await upload(citizen, complaint.id, [pngFile()], "photo");

        for (const [label, res] of Object.entries({ noFile, jsonBody, wrongField })) {
            expect(res.status, label).toBe(400);
            expect(hasFieldError(res, "images"), label).toBe(true);
        }
    });

    it("accepts only real JPG, PNG and WEBP images", async () => {
        const pdf = await upload(citizen, complaint.id, [["doc.pdf", Buffer.from("%PDF-1.4 fake"), "application/pdf"]]);
        const disguised = await upload(citizen, complaint.id, [["evil.png", Buffer.from("<script>alert(1)</script>"), "image/png"]]);

        expect(pdf.status).toBe(400);
        expect(hasFieldError(pdf, "images")).toBe(true);
        expect(disguised.status).toBe(400);
        expect(disguised.body.errors).toEqual([{ field: "images", message: "evil.png is not a real JPG, PNG or WEBP image" }]);
    });

    it("limits the size of an image and the number of images in one request", async () => {
        const big = await upload(citizen, complaint.id, [
            ["big.png", Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024 + 10)]), "image/png"],
        ]);
        const three = await upload(citizen, complaint.id, [pngFile("a.png"), pngFile("b.png"), pngFile("c.png")]);

        expect(big.status).toBe(413);
        expect(hasFieldError(big, "images")).toBe(true);
        expect(three.status).toBe(400);
        expect(hasFieldError(three, "images")).toBe(true);
    });

    it("answers 404 for a missing complaint", async () => {
        expect((await upload(citizen, MISSING_ID, [pngFile()])).status).toBe(404);
    });

    it("has stored nothing after the refused requests", async () => {
        expect(cloudinaryTest.stored).toHaveLength(0);
        expect(await prisma.complaintAttachment.count()).toBe(0);
    });

    it("stores a png as evidence in the folder of the complaint", async () => {
        const res = await upload(citizen, complaint.id, [pngFile()]);

        expect(res.status).toBe(201);
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toMatchObject({ kind: "EVIDENCE", bytes: png.length, uploadedBy: { id: citizen.id, role: "CITIZEN" } });
        expect(res.body.data[0].url).toContain(`${folderOf(complaint)}/`);
        expect(cloudinaryTest.stored).toEqual([expect.objectContaining({ folder: folderOf(complaint), bytes: png.length })]);
        firstImage = res.body.data[0];
    });

    it("stores a jpg and a webp sent together", async () => {
        const res = await upload(citizen, complaint.id, [
            ["b.jpg", jpg, "image/jpeg"],
            ["c.webp", webp, "image/webp"],
        ]);

        expect(res.status).toBe(201);
        expect(res.body.data).toHaveLength(2);
        expect(cloudinaryTest.stored).toHaveLength(3);
        expect(await savedCount(complaint.id)).toBe(3);
    });

    it("shows the images on the complaint without their Cloudinary ids", async () => {
        const res = await http(citizen.token).get(`/complaints/${complaint.id}`);

        expect(res.body.data.attachments).toHaveLength(3);
        expect(JSON.stringify(res.body.data.attachments)).not.toContain("publicId");
    });

    it("keeps the images out of public tracking", async () => {
        const res = await http().get(`/complaints/track/${complaint.trackingCode}`);

        expect(res.status).toBe(200);
        expect(res.body.data).not.toHaveProperty("attachments");
    });
});

describe("limits and roles", () => {
    it("allows six images per complaint at most and checks before uploading", async () => {
        expect((await upload(citizen, complaint.id, [pngFile("d.png"), pngFile("e.png")])).status).toBe(201);

        const tooMany = await upload(citizen, complaint.id, [pngFile("f.png"), pngFile("g.png")]);

        expect(tooMany.status).toBe(409);
        expect(cloudinaryTest.stored).toHaveLength(5);
        expect(await savedCount(complaint.id)).toBe(5);
    });

    it("lets an admin add the sixth image as evidence", async () => {
        const res = await upload(admin, complaint.id, [pngFile("admin.png")]);

        expect(res.status).toBe(201);
        expect(res.body.data[0]).toMatchObject({ kind: "EVIDENCE", uploadedBy: { id: admin.id, role: "ADMIN" } });
        expect(await savedCount(complaint.id)).toBe(6);
    });

    it("lets only the assigned staff member add proof of the work", async () => {
        second = await submitComplaint(citizen, pothole.id);
        await assignTo(admin, complaint.id, roadsStaff.id);
        await assignTo(admin, second.id, roadsStaff.id);

        expect((await upload(roadsStaff2, second.id, [pngFile("x.png")])).status).toBe(403);

        const res = await upload(roadsStaff, second.id, [pngFile("fixed.png")]);

        expect(res.status).toBe(201);
        expect(res.body.data[0]).toMatchObject({ kind: "RESOLUTION", uploadedBy: { id: roadsStaff.id, role: "STAFF" } });
        proof = res.body.data[0];
    });

    it("keeps the limit when five uploads of two images race and cleans up the refused images", async () => {
        third = await submitComplaint(citizen, pothole.id);

        const results = await Promise.all(
            Array.from({ length: 5 }, () => upload(citizen, third.id, [pngFile("r1.png"), pngFile("r2.png")]))
        );
        const statuses = results.map((res) => res.status);
        const saved = await prisma.complaintAttachment.findMany({
            where: { complaintId: third.id, deletedAt: null },
            select: { publicId: true },
        });
        const savedIds = saved.map((row) => row.publicId);
        const uploadedIds = storedIn(third);

        expect(
            statuses.filter((status) => status === 201),
            String(statuses)
        ).toHaveLength(3);
        expect(
            statuses.filter((status) => status === 409),
            String(statuses)
        ).toHaveLength(2);
        expect(savedIds).toHaveLength(6);
        expect(savedIds.every((publicId) => uploadedIds.includes(publicId))).toBe(true);
        expect(destroyedIn(third).sort()).toEqual(uploadedIds.filter((publicId) => !savedIds.includes(publicId)).sort());
    });
});

describe("cloudinary failures", () => {
    beforeAll(async () => {
        fourth = await submitComplaint(citizen, pothole.id);
    });

    it("turn into a 502 and save nothing", async () => {
        cloudinaryTest.failNextUploads(1);

        const res = await upload(citizen, fourth.id, [pngFile("bad.png")]);

        expect(res.status).toBe(502);
        expect(await savedCount(fourth.id)).toBe(0);
    });

    it("remove the image that did upload when the other one fails", async () => {
        cloudinaryTest.failNextUploads(1);

        const res = await upload(citizen, fourth.id, [pngFile("ok.png"), pngFile("bad.png")]);

        expect(res.status).toBe(502);
        expect(storedIn(fourth)).toHaveLength(1);
        expect(destroyedIn(fourth)).toEqual(storedIn(fourth));
        expect(await savedCount(fourth.id)).toBe(0);
    });
});

describe("remove", () => {
    it("is refused for other citizens and for staff who did not upload the image", async () => {
        expect((await removeImage(citizen2, complaint.id, firstImage.id)).status).toBe(403);
        expect((await removeImage(roadsStaff, complaint.id, firstImage.id)).status).toBe(403);
    });

    it("answers 400 for a bad id and 404 for an image of another complaint", async () => {
        expect((await removeImage(citizen, complaint.id, "not-an-id")).status).toBe(400);
        expect((await removeImage(citizen, second.id, firstImage.id)).status).toBe(404);
    });

    it("lets the uploader remove the image from Cloudinary and keeps the row soft deleted", async () => {
        const { publicId } = await prisma.complaintAttachment.findUniqueOrThrow({ where: { id: firstImage.id } });

        expect((await removeImage(citizen, complaint.id, firstImage.id)).status).toBe(200);
        expect(cloudinaryTest.destroyed.at(-1)).toBe(publicId);
        expect(publicId).toContain(complaint.trackingCode);
        expect((await prisma.complaintAttachment.findUniqueOrThrow({ where: { id: firstImage.id } })).deletedAt).not.toBeNull();
    });

    it("hides the removed image and cannot remove it twice", async () => {
        const res = await http(citizen.token).get(`/complaints/${complaint.id}`);

        expect(res.body.data.attachments).toHaveLength(5);
        expect(res.body.data.attachments.map((item: IAttachment) => item.id)).not.toContain(firstImage.id);
        expect((await removeImage(citizen, complaint.id, firstImage.id)).status).toBe(404);
    });

    it("lets an admin remove any image", async () => {
        expect((await removeImage(admin, second.id, proof.id)).status).toBe(200);
    });

    it("freezes the images once the complaint is finished", async () => {
        await moveStatus(admin, complaint.id, "REJECTED", "Rejected to test the closed state.");

        const attachments: IAttachment[] = (await http(citizen.token).get(`/complaints/${complaint.id}`)).body.data.attachments;
        const ownImage = attachments.find((item) => item.uploadedBy.id === citizen.id);

        expect((await upload(citizen, complaint.id, [pngFile("late.png")])).status).toBe(409);
        expect(ownImage).toBeDefined();
        expect((await removeImage(citizen, complaint.id, ownImage?.id ?? MISSING_ID)).status).toBe(409);
    });
});

describe("audit trail and configuration", () => {
    it("records added and removed images with their actors", async () => {
        const logs = await prisma.auditLog.findMany({
            where: { action: { in: ["ATTACHMENT_ADDED", "ATTACHMENT_REMOVED"] } },
            orderBy: { createdAt: "asc" },
        });
        const rows = (action: string, entityId: string) =>
            logs
                .filter((log) => log.action === action && log.entityId === entityId)
                .map((log) => ({ actorId: log.actorId, metadata: log.metadata }));

        expect(rows("ATTACHMENT_ADDED", complaint.id)).toEqual([
            { actorId: citizen.id, metadata: { kind: "EVIDENCE", count: 1 } },
            { actorId: citizen.id, metadata: { kind: "EVIDENCE", count: 2 } },
            { actorId: citizen.id, metadata: { kind: "EVIDENCE", count: 2 } },
            { actorId: admin.id, metadata: { kind: "EVIDENCE", count: 1 } },
        ]);
        expect(rows("ATTACHMENT_ADDED", second.id)).toEqual([{ actorId: roadsStaff.id, metadata: { kind: "RESOLUTION", count: 1 } }]);
        expect(rows("ATTACHMENT_ADDED", third.id)).toHaveLength(3);
        expect(rows("ATTACHMENT_ADDED", fourth.id)).toHaveLength(0);
        expect(rows("ATTACHMENT_REMOVED", complaint.id)).toEqual([{ actorId: citizen.id, metadata: { attachmentId: firstImage.id } }]);
        expect(rows("ATTACHMENT_REMOVED", second.id)).toEqual([{ actorId: admin.id, metadata: { attachmentId: proof.id } }]);
    });

    it("answers 503 when the Cloudinary keys are missing", async () => {
        const fresh = await submitComplaint(citizen2, pothole.id);

        cloudinaryTest.configure(false);

        try {
            const res = await upload(citizen2, fresh.id, [pngFile()]);

            expect(res.status).toBe(503);
            expect(res.body.message).toBe("Image upload is not configured");
        } finally {
            cloudinaryTest.configure(true);
        }

        expect(storedIn(fresh)).toHaveLength(0);
    });
});
