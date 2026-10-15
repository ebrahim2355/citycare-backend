import { z } from "zod";
import { paginationFields, uuidSchema } from "../../validations/common.validation";
import { AuditAction, AuditEntity } from "./audit.constant";

const actions = Object.values(AuditAction) as [string, ...string[]];
const entities = Object.values(AuditEntity) as [string, ...string[]];

const auditLogQuerySchema = z.object({
    query: z
        .object({
            ...paginationFields,
            action: z.enum(actions, "action is not a known audit action").optional(),
            entityType: z.enum(entities, "entityType must be USER, DEPARTMENT, CATEGORY, COMPLAINT, PAYMENT or MESSAGE").optional(),
            entityId: uuidSchema("entityId").optional(),
            actorId: uuidSchema("actorId").optional(),
            from: z.coerce.date("from must be a valid date").optional(),
            to: z.coerce.date("to must be a valid date").optional(),
        })
        .refine((query) => !query.from || !query.to || query.from <= query.to, {
            path: ["to"],
            message: "to must be the same as or after from",
        }),
});

export type TAuditLogQuery = z.infer<typeof auditLogQuerySchema>["query"];

export const AuditValidation = {
    auditLogQuerySchema,
};
