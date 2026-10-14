import { z } from "zod";
import { uuidSchema } from "../../validations/common.validation";

const initiatePaymentSchema = z.object({
    body: z.object({
        complaintId: uuidSchema("complaintId"),
        clientUrl: z.url("clientUrl must be a valid URL").optional(),
    }),
});

export type TInitiatePaymentPayload = z.infer<typeof initiatePaymentSchema>["body"];

export const PaymentValidation = {
    initiatePaymentSchema,
};
