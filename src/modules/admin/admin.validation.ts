import { z } from "zod";
import { paginationFields, uuidSchema } from "../../validations/common.validation";
import { AuthValidation } from "../auth/auth.validation";

const roles = ["CITIZEN", "STAFF", "ADMIN"] as const;
const roleSchema = z.enum(roles, "role must be CITIZEN, STAFF or ADMIN");

const requiresDepartment = (body: { role?: string | undefined; departmentId?: string | undefined }) => {
    return body.role !== "STAFF" || Boolean(body.departmentId);
};

const departmentRule = { path: ["departmentId"], message: "departmentId is required for a staff member" };

const userQuerySchema = z.object({
    query: z.object({
        ...paginationFields,
        sortBy: z.enum(["createdAt", "name", "email"], "sortBy must be createdAt, name or email").optional(),
        role: roleSchema.optional(),
        status: z.enum(["ACTIVE", "BLOCKED"], "status must be ACTIVE or BLOCKED").optional(),
        departmentId: uuidSchema("departmentId").optional(),
        searchTerm: z.string().trim().max(100, "searchTerm is too long").optional(),
    }),
});

const createUserSchema = z.object({
    body: z
        .object({
            name: z
                .string("Name is required")
                .trim()
                .min(2, "Name must be at least 2 characters")
                .max(80, "Name cannot be longer than 80 characters"),
            email: AuthValidation.emailSchema,
            password: AuthValidation.passwordSchema,
            role: z.enum(["STAFF", "ADMIN"], "role must be STAFF or ADMIN"),
            departmentId: uuidSchema("departmentId").optional(),
            phone: z
                .string()
                .trim()
                .regex(/^\+?[0-9]{7,15}$/, "Phone must be 7 to 15 digits")
                .optional(),
        })
        .refine(requiresDepartment, departmentRule),
});

const updateRoleSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z
        .object({
            role: roleSchema,
            departmentId: uuidSchema("departmentId").optional(),
        })
        .refine(requiresDepartment, departmentRule),
});

const updateStatusSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z.object({
        status: z.enum(["ACTIVE", "BLOCKED"], "status must be ACTIVE or BLOCKED"),
        reason: z.string().trim().max(300, "reason cannot be longer than 300 characters").optional(),
    }),
});

const staffQuerySchema = z.object({
    query: z.object({
        departmentId: uuidSchema("departmentId").optional(),
    }),
});

export type TUserQuery = z.infer<typeof userQuerySchema>["query"];
export type TCreateUserPayload = z.infer<typeof createUserSchema>["body"];
export type TUpdateRolePayload = z.infer<typeof updateRoleSchema>["body"];
export type TUpdateStatusPayload = z.infer<typeof updateStatusSchema>["body"];
export type TStaffQuery = z.infer<typeof staffQuerySchema>["query"];

export const AdminValidation = {
    userQuerySchema,
    createUserSchema,
    updateRoleSchema,
    updateStatusSchema,
    staffQuerySchema,
};
