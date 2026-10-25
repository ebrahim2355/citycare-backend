import { describe, expect, it } from "vitest";
import { detectImageType } from "../../src/middlewares/upload";

const bytes = (...values: number[]) => Buffer.from(values);

describe("detectImageType", () => {
    it("reads the real type from the first bytes of the file", () => {
        expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe("jpg");
        expect(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe("png");
        expect(detectImageType(Buffer.concat([Buffer.from("RIFF"), bytes(0, 0, 0, 0), Buffer.from("WEBPVP8 ")]))).toBe("webp");
    });

    it("refuses other files even when they are named like images", () => {
        expect(detectImageType(Buffer.from("GIF89a....."))).toBeNull();
        expect(detectImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBeNull();
        expect(detectImageType(Buffer.from("%PDF-1.7"))).toBeNull();
        expect(detectImageType(bytes(0xff, 0xd8))).toBeNull();
        expect(detectImageType(Buffer.alloc(0))).toBeNull();
    });
});
