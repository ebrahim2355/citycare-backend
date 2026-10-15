import { z } from "zod";
import { paginationFields, uuidSchema } from "../../validations/common.validation";

const topics = ["GENERAL", "COMPLAINT_HELP", "PAYMENT", "ACCOUNT", "FEEDBACK"] as const;

const createMessageSchema = z.object({
    body: z.object({
        name: z
            .string("Name is required")
            .trim()
            .min(2, "Name must be at least 2 characters")
            .max(80, "Name cannot be longer than 80 characters"),
        email: z.email("A valid email is required").trim().toLowerCase(),
        topic: z.enum(topics, "topic must be GENERAL, COMPLAINT_HELP, PAYMENT, ACCOUNT or FEEDBACK").default("GENERAL"),
        subject: z
            .string("Subject is required")
            .trim()
            .min(3, "Subject must be at least 3 characters")
            .max(120, "Subject cannot be longer than 120 characters"),
        message: z
            .string("Message is required")
            .trim()
            .min(10, "Message must be at least 10 characters")
            .max(2000, "Message cannot be longer than 2000 characters"),
    }),
});

const messageQuerySchema = z.object({
    query: z.object({
        ...paginationFields,
        status: z.enum(["NEW", "REPLIED", "CLOSED"], "status must be NEW, REPLIED or CLOSED").optional(),
        topic: z.enum(topics, "topic is not valid").optional(),
        searchTerm: z.string().trim().max(100, "searchTerm is too long").optional(),
    }),
});

const replySchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z.object({
        reply: z
            .string("reply is required")
            .trim()
            .min(10, "reply must be at least 10 characters")
            .max(2000, "reply cannot be longer than 2000 characters"),
    }),
});

const updateStatusSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z.object({
        status: z.enum(["NEW", "CLOSED"], "status must be NEW or CLOSED"),
    }),
});

export type TCreateMessagePayload = z.infer<typeof createMessageSchema>["body"];
export type TMessageQuery = z.infer<typeof messageQuerySchema>["query"];
export type TReplyPayload = z.infer<typeof replySchema>["body"];
export type TMessageStatusPayload = z.infer<typeof updateStatusSchema>["body"];

export const ContactValidation = {
    createMessageSchema,
    messageQuerySchema,
    replySchema,
    updateStatusSchema,
};
