import { z } from "zod";

export const uuidSchema = (label = "id") => z.uuid(`${label} must be a valid id`);

export const idParamSchema = z.object({
    params: z.object({
        id: uuidSchema(),
    }),
});

export const paginationFields = {
    page: z.coerce.number("page must be a number").int().min(1, "page must be at least 1").optional(),
    limit: z.coerce
        .number("limit must be a number")
        .int()
        .min(1, "limit must be at least 1")
        .max(100, "limit cannot be more than 100")
        .optional(),
    sortOrder: z.enum(["asc", "desc"], "sortOrder must be asc or desc").optional(),
};

export const optionalText = (max: number, label: string) =>
    z.string().trim().max(max, `${label} cannot be longer than ${max} characters`).optional();
