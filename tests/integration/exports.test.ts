import { beforeAll, describe, expect, it } from "vitest";
import { stripeTest } from "../fakes/stripe";
import { prisma, resetDatabase } from "../helpers/db";
import { createCity, submitComplaint } from "../helpers/factories";
import { http } from "../helpers/http";

type TCity = Awaited<ReturnType<typeof createCity>>;

let city: TCity;
let hole: { id: string; trackingCode: string };
let request: { id: string; trackingCode: string };

const parseCsv = (text: string) => {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = "";
    let quoted = false;

    for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (quoted) {
            if (char === '"' && text[index + 1] === '"') {
                cell += '"';
                index++;
            } else if (char === '"') {
                quoted = false;
            } else {
                cell += char;
            }
        } else if (char === '"') {
            quoted = true;
        } else if (char === ",") {
            row.push(cell);
            cell = "";
        } else if (char === "\r" && text[index + 1] === "\n") {
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
            index++;
        } else {
            cell += char;
        }
    }

    return rows;
};

const download = async (path: string, token = city.admin.token) => {
    const res = await http(token)
        .raw.get(path)
        .buffer(true)
        .parse((response, callback) => {
            let text = "";

            response.setEncoding("utf8");
            response.on("data", (chunk: string) => {
                text += chunk;
            });
            response.on("end", () => callback(null, text));
        });

    return { res, text: res.body as string };
};

beforeAll(async () => {
    await resetDatabase();
    city = await createCity();
    hole = await submitComplaint(city.citizen, city.pothole.id, {
        title: '=HYPERLINK("http://evil.example","Click")',
        address: 'Road 8, near the "blue" gate',
        area: "Dhanmondi",
        latitude: 23.7461,
        longitude: 90.3742,
    });
    await submitComplaint(city.citizen2, city.light.id, { title: "Dark street near the market", area: "Mirpur" });
    request = await submitComplaint(city.citizen, city.bulk.id, { title: "Sofa pickup" });

    const initiated = await http(city.citizen.token).post("/payments/initiate", { complaintId: request.id });
    const sessionId = initiated.body.data.payment.transactionId;

    stripeTest.pay(sessionId);
    await http(city.citizen.token).post("/payments/verify", { sessionId });
});

describe("complaint export", () => {
    it("is only for admins", async () => {
        expect((await http().raw.get("/admin/exports/complaints")).status).toBe(401);
        expect((await http(city.citizen.token).raw.get("/admin/exports/complaints")).status).toBe(403);
        expect((await http(city.roadsStaff.token).raw.get("/admin/exports/complaints")).status).toBe(403);
    });

    it("downloads a UTF-8 CSV file with a header row", async () => {
        const { res, text } = await download("/admin/exports/complaints");
        const [header, ...rows] = parseCsv(text.replace(/^﻿/, ""));

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
        expect(res.headers["content-disposition"]).toMatch(/^attachment; filename="citycare-complaints-\d{4}-\d{2}-\d{2}\.csv"$/);
        expect(text.startsWith("﻿")).toBe(true);
        expect(header?.slice(0, 3)).toEqual(["Tracking code", "Title", "Type"]);
        expect(rows).toHaveLength(3);
        expect(rows.every((row) => row.length === header?.length)).toBe(true);
    });

    it("keeps commas and quotes inside their cell and neutralises formulas", async () => {
        const { text } = await download("/admin/exports/complaints?area=Dhanmondi");
        const [header, row] = parseCsv(text.replace(/^﻿/, ""));
        const cell = (name: string) => row?.[header?.indexOf(name) ?? -1];

        expect(cell("Tracking code")).toBe(hole.trackingCode);
        expect(cell("Title")).toBe('\'=HYPERLINK("http://evil.example","Click")');
        expect(cell("Address")).toBe('Road 8, near the "blue" gate');
        expect(cell("Citizen email")).toBe(city.citizen.email);
        expect(cell("Public")).toBe("yes");
        expect(cell("Latitude")).toBe("23.7461");
    });

    it("uses the same filters as the list", async () => {
        const { text } = await download(`/admin/exports/complaints?categoryId=${city.light.id}`);

        expect(parseCsv(text.replace(/^﻿/, ""))).toHaveLength(2);
        expect((await http(city.admin.token).raw.get("/admin/exports/complaints?status=SOON")).status).toBe(400);
    });
});

describe("payment export", () => {
    it("lists the payments with amounts and request codes", async () => {
        const { res, text } = await download("/admin/exports/payments?status=COMPLETED");
        const [header, row] = parseCsv(text.replace(/^﻿/, ""));
        const cell = (name: string) => row?.[header?.indexOf(name) ?? -1];

        expect(res.headers["content-disposition"]).toContain("citycare-payments-");
        expect(cell("Tracking code")).toBe(request.trackingCode);
        expect(cell("Amount")).toBe("15.00");
        expect(cell("Currency")).toBe("USD");
        expect(cell("Status")).toBe("COMPLETED");
    });

    it("writes every download to the audit log", async () => {
        const logs = await prisma.auditLog.findMany({ where: { action: "DATA_EXPORTED" }, orderBy: { createdAt: "asc" } });

        expect(logs.map((log) => [log.entityType, (log.metadata as { rows: number }).rows])).toEqual([
            ["COMPLAINT", 3],
            ["COMPLAINT", 1],
            ["COMPLAINT", 1],
            ["PAYMENT", 1],
        ]);
        expect(logs.every((log) => log.actorId === city.admin.id)).toBe(true);
    });
});
