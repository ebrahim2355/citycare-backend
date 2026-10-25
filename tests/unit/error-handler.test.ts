import type { Request, Response } from "express";
import { MulterError } from "multer";
import Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import AppError from "../../src/errors/AppError";
import { Prisma } from "../../src/generated/prisma/client";
import globalErrorHandler from "../../src/middlewares/globalErrorHandler";

const handle = (error: unknown) => {
    const res = { status: vi.fn(), json: vi.fn(), err: undefined as unknown };

    res.status.mockReturnValue(res);
    globalErrorHandler(error, {} as Request, res as unknown as Response, vi.fn());

    return { status: res.status.mock.calls[0]?.[0] as number, body: res.json.mock.calls[0]?.[0], logged: res.err };
};

const prismaError = (code: string) => new Prisma.PrismaClientKnownRequestError("Database error", { code, clientVersion: "7.10.0" });

describe("globalErrorHandler", () => {
    it("keeps the status and the errors of an AppError", () => {
        const result = handle(new AppError(409, "Status change is not allowed", [{ field: "status", message: "Not now" }]));

        expect(result.status).toBe(409);
        expect(result.body).toEqual({
            success: false,
            message: "Status change is not allowed",
            errors: [{ field: "status", message: "Not now" }],
        });
    });

    it("turns zod issues into field errors without the request part of the path", () => {
        const schema = z.object({ body: z.object({ email: z.email("A valid email is required") }) });
        const parsed = schema.safeParse({ body: { email: "nope" } });
        const result = handle(parsed.error);

        expect(result.status).toBe(400);
        expect(result.body.errors).toEqual([{ field: "email", message: "A valid email is required" }]);
    });

    it.each([
        ["P2002", 409, "Duplicate value"],
        ["P2025", 404, "Record not found"],
        ["P2003", 400, "Invalid reference"],
        ["P2010", 400, "Database request failed"],
    ])("maps the prisma error %s to %i", (code, status, message) => {
        const result = handle(prismaError(code));

        expect(result.status).toBe(status);
        expect(result.body.message).toBe(message);
    });

    it("maps stripe errors to payment and gateway statuses", () => {
        expect(handle(new Stripe.errors.StripeCardError({ type: "card_error", message: "Your card was declined." })).status).toBe(402);
        expect(handle(new Stripe.errors.StripeInvalidRequestError({ type: "invalid_request_error", message: "Bad" })).status).toBe(400);
        expect(handle(new Stripe.errors.StripeAPIError({ type: "api_error", message: "Down" })).status).toBe(502);
    });

    it("explains upload limits", () => {
        const tooBig = handle(new MulterError("LIMIT_FILE_SIZE", "images"));
        const tooMany = handle(new MulterError("LIMIT_FILE_COUNT", "images"));

        expect(tooBig.status).toBe(413);
        expect(tooBig.body.errors[0]).toEqual({ field: "images", message: "Each image can be 2 MB at most" });
        expect(tooMany.status).toBe(400);
    });

    it("answers 400 for a body that is not valid JSON", () => {
        const syntax = Object.assign(new SyntaxError("Unexpected token"), { status: 400 });

        expect(handle(syntax)).toMatchObject({ status: 400, body: { message: "Invalid request body" } });
    });

    it("hands unknown errors to the request logger and answers 500", () => {
        const error = new Error("Connection reset");
        const result = handle(error);

        expect(result.status).toBe(500);
        expect(result.body.message).toBe("Something went wrong");
        expect(result.logged).toBe(error);
    });
});
