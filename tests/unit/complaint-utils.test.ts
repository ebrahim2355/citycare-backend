import { describe, expect, it } from "vitest";
import { ComplaintStatus } from "../../src/generated/prisma/client";
import { addHours, generateTrackingCode, isOverdue, withOverdue } from "../../src/modules/complaint/complaint.utils";

describe("generateTrackingCode", () => {
    it("uses the CC-YYMMDD-XXXXXX format with the date of the complaint", () => {
        const code = generateTrackingCode(new Date("2026-10-28T09:30:00Z"));

        expect(code).toMatch(/^CC-261028-[A-Z0-9]{6}$/);
    });

    it("never uses characters that are easy to confuse", () => {
        const codes = Array.from({ length: 300 }, () => generateTrackingCode().slice(10)).join("");

        expect(codes).not.toMatch(/[01IO]/);
    });

    it("gives different codes for the same day", () => {
        const day = new Date("2026-01-05T00:00:00Z");
        const codes = new Set(Array.from({ length: 200 }, () => generateTrackingCode(day)));

        expect(codes.size).toBe(200);
    });
});

describe("addHours", () => {
    it("adds whole and partial hours without changing the original date", () => {
        const start = new Date("2026-10-28T00:00:00Z");

        expect(addHours(start, 48).toISOString()).toBe("2026-10-30T00:00:00.000Z");
        expect(addHours(start, 1.5).toISOString()).toBe("2026-10-28T01:30:00.000Z");
        expect(start.toISOString()).toBe("2026-10-28T00:00:00.000Z");
    });
});

describe("isOverdue", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const past = new Date("2026-10-28T11:00:00Z");
    const future = new Date("2026-10-28T13:00:00Z");

    it.each([ComplaintStatus.SUBMITTED, ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS])(
        "is overdue when an open complaint (%s) passed its due date",
        (status) => {
            expect(isOverdue({ status, dueAt: past }, now)).toBe(true);
            expect(isOverdue({ status, dueAt: future }, now)).toBe(false);
        }
    );

    it.each([
        ComplaintStatus.PENDING_PAYMENT,
        ComplaintStatus.RESOLVED,
        ComplaintStatus.CLOSED,
        ComplaintStatus.REJECTED,
        ComplaintStatus.CANCELLED,
    ])("is never overdue when the complaint is %s", (status) => {
        expect(isOverdue({ status, dueAt: past }, now)).toBe(false);
    });

    it("is not overdue without a due date", () => {
        expect(isOverdue({ status: ComplaintStatus.SUBMITTED, dueAt: null }, now)).toBe(false);
    });

    it("adds the flag to a complaint object", () => {
        const complaint = withOverdue({ id: "a", status: ComplaintStatus.SUBMITTED, dueAt: new Date(Date.now() - 1000) });

        expect(complaint).toEqual(expect.objectContaining({ id: "a", isOverdue: true }));
    });
});
