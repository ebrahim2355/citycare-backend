import { z } from "zod";
import { paginationFields, uuidSchema } from "../../validations/common.validation";

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

const paymentQuerySchema = z.object({
    query: z.object({
        ...paginationFields,
        status: z.enum(["PENDING", "COMPLETED", "FAILED", "CANCELLED", "REFUNDED"], "status is not valid").optional(),
        complaintId: uuidSchema("complaintId").optional(),
        citizenId: uuidSchema("citizenId").optional(),
    }),
});

export type TInitiatePaymentPayload = z.infer<typeof initiatePaymentSchema>["body"];
export type TPaymentQuery = z.infer<typeof paymentQuerySchema>["query"];

export const PaymentValidation = {
    initiatePaymentSchema,
    verifyPaymentSchema,
    callbackQuerySchema,
    paymentQuerySchema,
};
