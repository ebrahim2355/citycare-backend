import { describe, expect, it } from "vitest";
import { boundingBox, distanceMeters, roundCoordinate } from "../../src/utils/geo";

const school = { latitude: 23.7461, longitude: 90.3742 };

describe("distanceMeters", () => {
    it("measures short distances on the ground", () => {
        expect(distanceMeters(school, school)).toBe(0);
        expect(distanceMeters(school, { latitude: 23.7471, longitude: 90.3742 })).toBeCloseTo(111.2, 0);
        expect(distanceMeters(school, { latitude: 23.8759, longitude: 90.3795 })).toBeGreaterThan(14000);
    });

    it("is the same in both directions", () => {
        const other = { latitude: 23.7937, longitude: 90.4066 };

        expect(distanceMeters(school, other)).toBeCloseTo(distanceMeters(other, school), 6);
    });
});

describe("boundingBox", () => {
    it("contains every point inside the radius", () => {
        const box = boundingBox(school, 300);

        for (const bearing of [0, 45, 90, 135, 180, 225, 270, 315]) {
            const radians = (bearing * Math.PI) / 180;
            const point = {
                latitude: school.latitude + (299 / 111320) * Math.cos(radians),
                longitude: school.longitude + (299 / (111320 * Math.cos((school.latitude * Math.PI) / 180))) * Math.sin(radians),
            };

            expect(distanceMeters(school, point)).toBeLessThanOrEqual(300);
            expect(point.latitude).toBeGreaterThanOrEqual(box.minLat);
            expect(point.latitude).toBeLessThanOrEqual(box.maxLat);
            expect(point.longitude).toBeGreaterThanOrEqual(box.minLng);
            expect(point.longitude).toBeLessThanOrEqual(box.maxLng);
        }
    });
});

describe("roundCoordinate", () => {
    it("keeps about ten meters of precision for public data", () => {
        expect(roundCoordinate(23.7461234)).toBe(23.7461);
        expect(roundCoordinate(90.37425)).toBe(90.3743);
        expect(roundCoordinate(90.3742345, 6)).toBe(90.374235);
    });
});
