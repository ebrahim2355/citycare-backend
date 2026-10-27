import { describe, expect, it } from "vitest";
import { csvCell, csvRow } from "../../src/utils/csv";

describe("csvCell", () => {
    it("leaves plain values alone and empties missing ones", () => {
        expect(csvCell("Pothole")).toBe("Pothole");
        expect(csvCell(42)).toBe("42");
        expect(csvCell(-3.5)).toBe("-3.5");
        expect(csvCell(true)).toBe("true");
        expect(csvCell(null)).toBe("");
        expect(csvCell(undefined)).toBe("");
    });

    it("writes dates as ISO strings", () => {
        expect(csvCell(new Date("2026-10-28T09:30:00Z"))).toBe("2026-10-28T09:30:00.000Z");
    });

    it("quotes commas, quotes, line breaks and edge spaces", () => {
        expect(csvCell("Road 8, Dhanmondi")).toBe('"Road 8, Dhanmondi"');
        expect(csvCell('The "big" hole')).toBe('"The ""big"" hole"');
        expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
        expect(csvCell(" padded ")).toBe('" padded "');
    });

    it.each([
        ['=HYPERLINK("http://evil.example")', '\'=HYPERLINK("http://evil.example")'],
        ["+8801712345678", "'+8801712345678"],
        ["-1+2", "'-1+2"],
        ["@SUM(A1:A9)", "'@SUM(A1:A9)"],
        ["\tcmd", "'\tcmd"],
    ])("stops %s from running as a spreadsheet formula", (value, expected) => {
        expect(csvCell(value).replace(/^"|"$/g, "").replace(/""/g, '"')).toBe(expected);
    });
});

describe("csvRow", () => {
    it("joins the cells with commas and ends with CRLF", () => {
        expect(csvRow(["CC-261028-ABC234", "Hole, deep", null, 3])).toBe('CC-261028-ABC234,"Hole, deep",,3\r\n');
    });
});
