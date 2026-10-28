import { z } from "zod";
import { PaymentMethod } from "../../generated/prisma/client";
import { paginationFields, uuidSchema } from "../../validations/common.validation";
import { SSL_TRAN_ID_PATTERN } from "./payment.constant";

const sessionIdSchema = z
    .string("Checkout session id is required")
    .trim()
    .regex(/^cs_(test|live)_[A-Za-z0-9]+$/, "Checkout session id is not valid");

const tranIdSchema = z.string("Transaction id is required").trim().regex(SSL_TRAN_ID_PATTERN, "Transaction id is not valid");

const oneReference = (sessionKey: string, tranKey: string) => (value: Record<string, unknown>) =>
    Boolean(value[sessionKey]) !== Boolean(value[tranKey]);

const initiatePaymentSchema = z.object({
    body: z.object({
        complaintId: uuidSchema("complaintId"),
        method: z.enum(PaymentMethod, "method must be CARD, BKASH or NAGAD").default(PaymentMethod.CARD),
        clientUrl: z.url("clientUrl must be a valid URL").optional(),
    }),
});

const verifyPaymentSchema = z.object({
    body: z
        .object({
            sessionId: sessionIdSchema.optional(),
            tranId: tranIdSchema.optional(),
        })
        .refine(oneReference("sessionId", "tranId"), {
            message: "Send sessionId for a card payment or tranId for a bKash or Nagad payment",
            path: ["sessionId"],
        }),
});

const callbackQuerySchema = z.object({
    query: z
        .object({
            session_id: sessionIdSchema.optional(),
            tran_id: tranIdSchema.optional(),
        })
        .refine(oneReference("session_id", "tran_id"), {
            message: "Send session_id for a card payment or tran_id for a bKash or Nagad payment",
            path: ["session_id"],
        }),
});

const sslReturnSchema = z.object({
    body: z.object({
        tran_id: tranIdSchema,
    }),
    query: z.object({
        client: z.string().optional(),
    }),
});

const sslIpnSchema = z.object({
    body: z.object({
        tran_id: tranIdSchema,
        status: z.string().optional(),
    }),
});

const paymentQuerySchema = z.object({
    query: z.object({
        ...paginationFields,
        status: z.enum(["PENDING", "COMPLETED", "FAILED", "CANCELLED", "REFUNDED"], "status is not valid").optional(),
        method: z.enum(PaymentMethod, "method is not valid").optional(),
        complaintId: uuidSchema("complaintId").optional(),
        citizenId: uuidSchema("citizenId").optional(),
    }),
});

export type TInitiatePaymentPayload = z.infer<typeof initiatePaymentSchema>["body"];
export type TVerifyPaymentPayload = z.infer<typeof verifyPaymentSchema>["body"];
export type TCallbackQuery = z.infer<typeof callbackQuerySchema>["query"];
export type TPaymentQuery = z.infer<typeof paymentQuerySchema>["query"];

export const PaymentValidation = {
    initiatePaymentSchema,
    verifyPaymentSchema,
    callbackQuerySchema,
    sslReturnSchema,
    sslIpnSchema,
    paymentQuerySchema,
};
