import { describe, expect, it, vi } from "vitest";
import { getCache, remember } from "../../src/utils/cache";
import { getMeta, getPagination } from "../../src/utils/pagination";

describe("pagination", () => {
    it("uses page 1, 10 items and newest first by default", () => {
        expect(getPagination({})).toEqual({ page: 1, limit: 10, skip: 0, sortOrder: "desc" });
    });

    it("skips the rows of the previous pages", () => {
        expect(getPagination({ page: 3, limit: 25, sortOrder: "asc" })).toEqual({ page: 3, limit: 25, skip: 50, sortOrder: "asc" });
    });

    it("counts the pages", () => {
        expect(getMeta(1, 10, 0)).toEqual({ page: 1, limit: 10, total: 0, totalPages: 0 });
        expect(getMeta(2, 10, 21)).toEqual({ page: 2, limit: 10, total: 21, totalPages: 3 });
    });
});

describe("cache without redis", () => {
    it("always calls the loader and reports a miss", async () => {
        const loader = vi.fn(async () => ({ total: 4 }));

        await expect(remember("stats:public", 60, loader)).resolves.toEqual({ data: { total: 4 }, cached: false });
        await expect(remember("stats:public", 60, loader)).resolves.toEqual({ data: { total: 4 }, cached: false });
        expect(loader).toHaveBeenCalledTimes(2);
        await expect(getCache("stats:public")).resolves.toBeNull();
    });
});
