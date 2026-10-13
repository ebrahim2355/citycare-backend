import { z } from "zod";
import { uuidSchema } from "../../validations/common.validation";

const categoryFields = {
    name: z
        .string("Category name is required")
        .trim()
        .min(2, "Category name must be at least 2 characters")
        .max(80, "Category name cannot be longer than 80 characters"),
    description: z.string().trim().max(500, "Description cannot be longer than 500 characters").optional(),
    type: z.enum(["COMPLAINT", "SERVICE"], "type must be COMPLAINT or SERVICE"),
    fee: z.number("fee must be a number").min(0, "fee cannot be negative").max(100000, "fee is too large"),
    slaHours: z
        .number("slaHours must be a number")
        .int("slaHours must be a whole number")
        .min(1, "slaHours must be at least 1")
        .max(720, "slaHours cannot be more than 720"),
    departmentId: uuidSchema("departmentId"),
    isActive: z.boolean("isActive must be true or false"),
};

const createCategorySchema = z.object({
    body: z
        .object({
            name: categoryFields.name,
            description: categoryFields.description,
            type: categoryFields.type.default("COMPLAINT"),
            fee: categoryFields.fee.default(0),
            slaHours: categoryFields.slaHours.default(72),
            departmentId: categoryFields.departmentId,
        })
        .refine((body) => body.type === "SERVICE" || body.fee === 0, {
            path: ["fee"],
            message: "A complaint category cannot have a fee",
        }),
});

const updateCategorySchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z
        .object({
            name: categoryFields.name.optional(),
            description: categoryFields.description,
            type: categoryFields.type.optional(),
            fee: categoryFields.fee.optional(),
            slaHours: categoryFields.slaHours.optional(),
            departmentId: categoryFields.departmentId.optional(),
            isActive: categoryFields.isActive.optional(),
        })
        .refine((body) => Object.keys(body).length > 0, "Send at least one field to update"),
});

const categoryQuerySchema = z.object({
    query: z.object({
        type: categoryFields.type.optional(),
        departmentId: categoryFields.departmentId.optional(),
        searchTerm: z.string().trim().max(80, "searchTerm is too long").optional(),
        includeInactive: z.enum(["true", "false"], "includeInactive must be true or false").optional(),
    }),
});

export type TCreateCategoryPayload = z.infer<typeof createCategorySchema>["body"];
export type TUpdateCategoryPayload = z.infer<typeof updateCategorySchema>["body"];
export type TCategoryQuery = z.infer<typeof categoryQuerySchema>["query"];

export const CategoryValidation = {
    createCategorySchema,
    updateCategorySchema,
    categoryQuerySchema,
};
