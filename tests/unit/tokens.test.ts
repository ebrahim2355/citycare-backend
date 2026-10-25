import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import AppError from "../../src/errors/AppError";
import { createAccessToken, verifyAccessToken } from "../../src/utils/jwt";
import { comparePassword, hashPassword } from "../../src/utils/password";
import { generateToken, hashToken } from "../../src/utils/token";

describe("access tokens", () => {
    const user = { id: "6f1c4b7e-1d2a-4c3b-9e8f-7a6b5c4d3e2f", email: "a@test.com", role: "CITIZEN" as const };

    it("round trips the user claims", () => {
        const decoded = verifyAccessToken(createAccessToken(user));

        expect(decoded).toMatchObject(user);
        expect(decoded.exp).toBeGreaterThan(decoded.iat ?? 0);
    });

    it("refuses a token signed with another secret", () => {
        const forged = jwt.sign(user, "another-secret-that-is-also-long-enough");

        expect(() => verifyAccessToken(forged)).toThrowError(AppError);
    });

    it("refuses an expired token and a token without an id", () => {
        const expired = jwt.sign({ ...user, exp: Math.floor(Date.now() / 1000) - 10 }, process.env.JWT_ACCESS_SECRET as string);
        const noId = jwt.sign({ email: user.email }, process.env.JWT_ACCESS_SECRET as string);

        for (const token of [expired, noId, "not-a-jwt"]) {
            try {
                verifyAccessToken(token);
                expect.unreachable();
            } catch (error) {
                expect(error).toBeInstanceOf(AppError);
                expect((error as AppError).statusCode).toBe(401);
            }
        }
    });
});

describe("opaque tokens", () => {
    it("creates random hex tokens and stores only their hash", () => {
        const token = generateToken();

        expect(token).toMatch(/^[0-9a-f]{80}$/);
        expect(generateToken()).not.toBe(token);
        expect(hashToken(token)).toBe(hashToken(token));
        expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
        expect(hashToken(token)).not.toContain(token);
    });
});

describe("passwords", () => {
    it("hashes with bcrypt and checks the plain password", async () => {
        const hash = await hashPassword("Secret12345");

        expect(hash).toMatch(/^\$2[aby]\$/);
        await expect(comparePassword("Secret12345", hash)).resolves.toBe(true);
        await expect(comparePassword("secret12345", hash)).resolves.toBe(false);
    });
});
