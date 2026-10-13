import { z } from "zod";
import { uuidSchema } from "../../validations/common.validation";

const departmentFields = {
    name: z
        .string("Department name is required")
        .trim()
        .min(2, "Department name must be at least 2 characters")
        .max(80, "Department name cannot be longer than 80 characters"),
    description: z.string().trim().max(500, "Description cannot be longer than 500 characters").optional(),
    contactEmail: z.email("contactEmail must be a valid email").trim().toLowerCase().optional(),
};

const createDepartmentSchema = z.object({
    body: z.object(departmentFields),
});

const updateDepartmentSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z
        .object({
            name: departmentFields.name.optional(),
            description: departmentFields.description,
            contactEmail: departmentFields.contactEmail,
        })
        .refine((body) => Object.keys(body).length > 0, "Send at least one field to update"),
});

export type TCreateDepartmentPayload = z.infer<typeof createDepartmentSchema>["body"];
export type TUpdateDepartmentPayload = z.infer<typeof updateDepartmentSchema>["body"];

export const DepartmentValidation = {
    createDepartmentSchema,
    updateDepartmentSchema,
};
