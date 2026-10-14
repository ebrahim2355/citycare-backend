import { z } from "zod";
import { uuidSchema } from "../../validations/common.validation";

const sessionIdSchema = z
    .string("Checkout session id is required")
    .trim()
    .regex(/^cs_(test|live)_[A-Za-z0-9]+$/, "Checkout session id is not valid");

const initiatePaymentSchema = z.object({
    body: z.object({
        complaintId: uuidSchema("complaintId"),
        clientUrl: z.url("clientUrl must be a valid URL").optional(),
    }),
});

const verifyPaymentSchema = z.object({
    body: z.object({
        sessionId: sessionIdSchema,
    }),
});

const callbackQuerySchema = z.object({
    query: z.object({
        session_id: sessionIdSchema,
    }),
});

export type TInitiatePaymentPayload = z.infer<typeof initiatePaymentSchema>["body"];

export const PaymentValidation = {
    initiatePaymentSchema,
    verifyPaymentSchema,
    callbackQuerySchema,
};
