import { beforeAll, describe, expect, it } from "vitest";
import { CategoryType } from "../../src/generated/prisma/client";
import { deleteCacheByPrefix } from "../../src/utils/cache";
import { prisma, resetDatabase } from "../helpers/db";
import { assignTo, createCity, moveStatus, resolveComplaint, submitComplaint } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

type TCity = Awaited<ReturnType<typeof createCity>>;

interface IReport {
    id: string;
    trackingCode: string;
    latitude: number;
    longitude: number;
    supportCount: number;
    distanceMeters?: number;
    isMine?: boolean;
    supportedByMe?: boolean;
}

const SCHOOL = { latitude: 23.7461234, longitude: 90.3742345 };

let city: TCity;
let schoolHole: IReport;
let privateHole: IReport;
let darkLight: IReport;
let farAway: IReport;
let noLocation: IReport;
let fixed: IReport;
let rejected: IReport;
let sofaPickup: IReport & { isPublic: boolean };

const freshPublic = async (query = "") => {
    await deleteCacheByPrefix("public-reports:");

    return http().get(`/complaints/public${query}`);
};

const codesOf = (reports: IReport[]) => reports.map((report) => report.trackingCode).sort();

beforeAll(async () => {
    await resetDatabase();
    city = await createCity();
    schoolHole = await submitComplaint(city.citizen, city.pothole.id, { title: "Hole at the school gate", ...SCHOOL });
    privateHole = await submitComplaint(city.citizen2, city.pothole.id, {
        title: "Hole in front of my house",
        latitude: 23.7465,
        longitude: 90.3745,
        isPublic: false,
    });
    darkLight = await submitComplaint(city.citizen2, city.light.id, {
        title: "Dark corner by the school",
        latitude: 23.747,
        longitude: 90.375,
    });
    farAway = await submitComplaint(city.citizen2, city.pothole.id, { title: "Hole in Uttara", latitude: 23.8759, longitude: 90.3795 });
    noLocation = await submitComplaint(city.citizen2, city.pothole.id, { title: "Hole somewhere in Mirpur" });
    fixed = await submitComplaint(city.citizen2, city.pothole.id, {
        title: "Fixed hole near the bridge",
        latitude: 23.7468,
        longitude: 90.3741,
    });
    await resolveComplaint(city.admin, city.roadsStaff, fixed.id);
    rejected = await submitComplaint(city.citizen2, city.pothole.id, { title: "Rejected hole", latitude: 23.7462, longitude: 90.3743 });
    await moveStatus(city.admin, rejected.id, "REJECTED", "Private driveway.");
    sofaPickup = await submitComplaint(city.citizen, city.bulk.id, { title: "Sofa pickup at home", ...SCHOOL, isPublic: true });
});

describe("visibility", () => {
    it("makes a complaint public by default, private on request and a home service always private", async () => {
        const rows = await prisma.complaint.findMany({
            where: { id: { in: [schoolHole.id, privateHole.id, sofaPickup.id] } },
            select: { id: true, isPublic: true },
        });
        const visibility = Object.fromEntries(rows.map((row) => [row.id, row.isPublic]));

        expect(visibility).toEqual({ [schoolHole.id]: true, [privateHole.id]: false, [sofaPickup.id]: false });
    });

    it("lets the citizen hide a report even after it was assigned, but nothing else", async () => {
        await assignTo(city.admin, darkLight.id, city.roadsStaff.id);

        const hide = await http(city.citizen2.token).patch(`/complaints/${darkLight.id}`, { isPublic: false });
        const edit = await http(city.citizen2.token).patch(`/complaints/${darkLight.id}`, { isPublic: true, title: "New title" });
        const show = await http(city.citizen2.token).patch(`/complaints/${darkLight.id}`, { isPublic: true });

        expect(hide.status).toBe(200);
        expect(hide.body.data.isPublic).toBe(false);
        expect(edit.status).toBe(409);
        expect(show.body.data.isPublic).toBe(true);
    });

    it("refuses to publish a home service request", async () => {
        const res = await http(city.citizen.token).patch(`/complaints/${sofaPickup.id}`, { isPublic: true });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "isPublic")).toBe(true);
    });

    it("does not let an admin change the visibility", async () => {
        expect((await http(city.admin.token).patch(`/complaints/${schoolHole.id}`, { isPublic: false })).status).toBe(400);
    });
});

describe("the public city map", () => {
    it("shows open public reports with a location and no personal data", async () => {
        const res = await freshPublic();

        expect(res.status).toBe(200);
        expect(codesOf(res.body.data)).toEqual(codesOf([schoolHole, darkLight, farAway]));

        const school = res.body.data.find((report: IReport) => report.id === schoolHole.id);

        expect(school).toMatchObject({ latitude: 23.7461, longitude: 90.3742, supportCount: 0, isOverdue: false });
        expect(school.category).toEqual({ id: city.pothole.id, name: "Pothole" });
        for (const field of ["citizen", "citizenId", "address", "description", "assignedStaff", "fee"]) {
            expect(school, field).not.toHaveProperty(field);
        }
    });

    it("answers from the cache the second time", async () => {
        const first = await freshPublic("?limit=50");
        const second = await http().get("/complaints/public?limit=50");

        expect(first.headers["x-cache"]).toBe("MISS");
        expect(second.headers["x-cache"]).toBe("HIT");
        expect(second.body.data).toEqual(first.body.data);
    });

    it("filters by status, category and map area", async () => {
        expect(codesOf((await freshPublic("?status=RESOLVED")).body.data)).toEqual([fixed.trackingCode]);
        expect(codesOf((await freshPublic("?status=ALL")).body.data)).toEqual(codesOf([schoolHole, darkLight, farAway, fixed]));
        expect(codesOf((await freshPublic(`?categoryId=${city.light.id}`)).body.data)).toEqual([darkLight.trackingCode]);
        expect(codesOf((await freshPublic("?minLat=23.8&maxLat=23.9&minLng=90.3&maxLng=90.4")).body.data)).toEqual([farAway.trackingCode]);
    });

    it("validates the query", async () => {
        expect((await http().get("/complaints/public?minLat=23.7")).status).toBe(400);
        expect((await http().get("/complaints/public?limit=501")).status).toBe(400);
        expect((await http().get("/complaints/public?status=SOON")).status).toBe(400);
    });

    it("shows the location and support count on the tracking page only for public reports", async () => {
        const open = await http().get(`/complaints/track/${schoolHole.trackingCode}`);
        const hidden = await http().get(`/complaints/track/${privateHole.trackingCode}`);

        expect(open.body.data).toMatchObject({ id: schoolHole.id, isPublic: true, latitude: 23.7461, supportCount: 0 });
        expect(hidden.body.data).toMatchObject({ id: null, isPublic: false, latitude: null, longitude: null });
        expect(noLocation.id).toBeTruthy();
    });
});

describe("nearby reports for the wizard", () => {
    it("needs a login and a valid point", async () => {
        expect((await http().get("/complaints/nearby?latitude=23.7&longitude=90.3")).status).toBe(401);
        expect((await http(city.citizen.token).get("/complaints/nearby?latitude=23.7")).status).toBe(400);
        expect((await http(city.citizen.token).get("/complaints/nearby?latitude=23.7&longitude=90.3&radius=5")).status).toBe(400);
    });

    it("lists open public reports around the spot, closest first", async () => {
        const res = await http(city.citizen2.token).get(`/complaints/nearby?latitude=${SCHOOL.latitude}&longitude=${SCHOOL.longitude}`);
        const reports: IReport[] = res.body.data;

        expect(res.status).toBe(200);
        expect(reports.map((report) => report.id)).toEqual([schoolHole.id, darkLight.id]);
        expect(reports[0]).toMatchObject({ distanceMeters: 0, isMine: false, supportedByMe: false });
        expect(reports[1]?.distanceMeters).toBeGreaterThan(100);
        expect(reports[1]?.distanceMeters).toBeLessThan(160);
        expect(reports[1]?.isMine).toBe(true);
    });

    it("narrows by category and radius", async () => {
        const light = await http(city.citizen.token).get(
            `/complaints/nearby?latitude=${SCHOOL.latitude}&longitude=${SCHOOL.longitude}&categoryId=${city.light.id}`
        );
        const close = await http(city.citizen.token).get(
            `/complaints/nearby?latitude=${SCHOOL.latitude}&longitude=${SCHOOL.longitude}&radius=50`
        );

        expect(light.body.data.map((report: IReport) => report.id)).toEqual([darkLight.id]);
        expect(close.body.data.map((report: IReport) => report.id)).toEqual([schoolHole.id]);
    });

    it("finds the closest report even where the area around it is crowded", async () => {
        const gulshan = { latitude: 23.7925, longitude: 90.4078 };
        const row = (id: string, number: number, latitude: number, longitude: number) => ({
            id,
            trackingCode: `CC-CROWD-${String(number).padStart(4, "0")}`,
            title: "Report at the edge of the search area",
            description: "One of many reports a little too far from the spot.",
            type: CategoryType.COMPLAINT,
            address: "Gulshan Avenue",
            area: "Gulshan",
            latitude,
            longitude,
            isPublic: true,
            citizenId: city.citizen2.id,
            categoryId: city.pothole.id,
            departmentId: city.roads.id,
        });
        const corners = Array.from({ length: 120 }, (_, index) =>
            row(
                `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
                index,
                gulshan.latitude + (index % 2 ? 0.0026 : -0.0026),
                gulshan.longitude + (index % 4 < 2 ? 0.0028 : -0.0028)
            )
        );
        const closest = row("ffffffff-ffff-4fff-bfff-ffffffffffff", 9999, gulshan.latitude, gulshan.longitude);

        await prisma.complaint.createMany({ data: [...corners, closest] });

        try {
            const res = await http(city.citizen.token).get(
                `/complaints/nearby?latitude=${gulshan.latitude}&longitude=${gulshan.longitude}`
            );

            expect(res.status).toBe(200);
            expect(res.body.data.map((report: IReport) => report.id)).toEqual([closest.id]);
        } finally {
            await prisma.complaint.deleteMany({ where: { id: { in: [...corners, closest].map((item) => item.id) } } });
        }
    });
});

describe("supporting a report", () => {
    it("is only for citizens and only for open public reports of others", async () => {
        expect((await http().post(`/complaints/${schoolHole.id}/support`)).status).toBe(401);
        expect((await http(city.roadsStaff.token).post(`/complaints/${schoolHole.id}/support`)).status).toBe(403);
        expect((await http(city.citizen.token).post(`/complaints/${schoolHole.id}/support`)).status).toBe(409);
        expect((await http(city.citizen.token).post(`/complaints/${privateHole.id}/support`)).status).toBe(404);
        expect((await http(city.citizen.token).post(`/complaints/${fixed.id}/support`)).status).toBe(409);
        expect((await http(city.citizen.token).post(`/complaints/${sofaPickup.id}/support`)).status).toBe(404);
    });

    it("counts each citizen once and tells the owner once", async () => {
        const first = await http(city.citizen2.token).post(`/complaints/${schoolHole.id}/support`);
        const again = await http(city.citizen2.token).post(`/complaints/${schoolHole.id}/support`);

        expect(first.body.data).toEqual({ supportCount: 1, supported: true });
        expect(again.body.data).toEqual({ supportCount: 1, supported: true });

        const withdrawn = await http(city.citizen2.token).delete(`/complaints/${schoolHole.id}/support`);

        expect(withdrawn.body.data).toEqual({ supportCount: 0, supported: false });
        await http(city.citizen2.token).post(`/complaints/${schoolHole.id}/support`);

        const told = await prisma.notification.findMany({ where: { userId: city.citizen.id, type: "REPORT_SUPPORTED" } });

        expect(told).toHaveLength(1);
        expect(told[0]?.title).toBe("A neighbour supports your report");
    });

    it("shows the support in the wizard, the public map and the admin list", async () => {
        const nearby = await http(city.citizen2.token).get(`/complaints/nearby?latitude=${SCHOOL.latitude}&longitude=${SCHOOL.longitude}`);
        const map = await freshPublic();
        const list = await http(city.admin.token).get("/complaints?sortBy=supportCount&sortOrder=desc&limit=3");

        expect(nearby.body.data[0]).toMatchObject({ id: schoolHole.id, supportCount: 1, supportedByMe: true });
        expect(map.body.data.find((report: IReport) => report.id === schoolHole.id).supportCount).toBe(1);
        expect(list.body.data[0]).toMatchObject({ id: schoolHole.id, supportCount: 1, isPublic: true });
    });

    it("tells a signed in viewer which reports they support or own, on the map and the tracking page", async () => {
        const school = (reports: IReport[]) => reports.find((report) => report.id === schoolHole.id);
        const anonymous = await freshPublic();
        const neighbour = await http(city.citizen2.token).get("/complaints/public");
        const owner = await http(city.citizen.token).get("/complaints/public");

        expect(school(anonymous.body.data)).toMatchObject({ isMine: false, supportedByMe: false });
        expect(neighbour.headers["x-cache"]).toBe("HIT");
        expect(school(neighbour.body.data)).toMatchObject({ isMine: false, supportedByMe: true });
        expect(school(owner.body.data)).toMatchObject({ isMine: true, supportedByMe: false });

        const track = (token?: string) => http(token).get(`/complaints/track/${schoolHole.trackingCode}`);
        const mine = (await track(city.citizen.token)).body.data;

        expect((await track()).body.data).toMatchObject({ supportCount: 1, isMine: false, supportedByMe: false });
        expect((await track(city.citizen2.token)).body.data).toMatchObject({ isMine: false, supportedByMe: true });
        expect(mine).toMatchObject({ isMine: true, supportedByMe: false });
        expect(mine).not.toHaveProperty("citizenId");
    });
});

describe("the map feed of the dashboards", () => {
    it("shows each role only its own part of the city", async () => {
        const ids = async (token: string, query = "") =>
            ((await http(token).get(`/complaints/map${query}`)).body.data as IReport[]).map((item) => item.id).sort();

        expect(await ids(city.admin.token)).toEqual([schoolHole.id, privateHole.id, darkLight.id, farAway.id].sort());
        expect(await ids(city.admin.token, "?status=ALL")).toEqual(
            [schoolHole.id, privateHole.id, darkLight.id, farAway.id, fixed.id, rejected.id, sofaPickup.id].sort()
        );
        expect(await ids(city.roadsStaff.token)).toEqual([darkLight.id]);
        expect(await ids(city.citizen.token)).toEqual([schoolHole.id]);
        expect((await http().get("/complaints/map")).status).toBe(401);
    });
});
