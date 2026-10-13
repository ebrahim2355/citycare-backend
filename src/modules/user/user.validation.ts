import { z } from "zod";

const updateProfileSchema = z.object({
    body: z
        .object({
            name: z
                .string()
                .trim()
                .min(2, "Name must be at least 2 characters")
                .max(80, "Name cannot be longer than 80 characters")
                .optional(),
            phone: z
                .string()
                .trim()
                .regex(/^\+?[0-9]{7,15}$/, "Phone must be 7 to 15 digits")
                .optional(),
            address: z.string().trim().max(200, "Address cannot be longer than 200 characters").optional(),
            avatarUrl: z.url("avatarUrl must be a valid URL").optional(),
        })
        .refine((body) => Object.keys(body).length > 0, "Send at least one field to update"),
});

export type TUpdateProfilePayload = z.infer<typeof updateProfileSchema>["body"];

export const UserValidation = {
    updateProfileSchema,
};
