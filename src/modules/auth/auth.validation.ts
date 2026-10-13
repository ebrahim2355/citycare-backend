import { z } from "zod";

const passwordSchema = z
    .string("Password is required")
    .min(8, "Password must be at least 8 characters")
    .max(72, "Password cannot be longer than 72 characters")
    .regex(/[A-Za-z]/, "Password must have at least one letter")
    .regex(/[0-9]/, "Password must have at least one number");

const emailSchema = z.email("A valid email is required").trim().toLowerCase();

const registerSchema = z.object({
    body: z.object({
        name: z
            .string("Name is required")
            .trim()
            .min(2, "Name must be at least 2 characters")
            .max(80, "Name cannot be longer than 80 characters"),
        email: emailSchema,
        password: passwordSchema,
        phone: z
            .string()
            .trim()
            .regex(/^\+?[0-9]{7,15}$/, "Phone must be 7 to 15 digits")
            .optional(),
        address: z.string().trim().max(200, "Address cannot be longer than 200 characters").optional(),
    }),
});

const loginSchema = z.object({
    body: z.object({
        email: emailSchema,
        password: z.string("Password is required").min(1, "Password is required"),
    }),
});

const refreshTokenSchema = z.object({
    body: z.object({
        refreshToken: z.string("refreshToken is required").min(20, "refreshToken is not valid"),
    }),
});

const changePasswordSchema = z.object({
    body: z
        .object({
            currentPassword: z.string().optional(),
            newPassword: passwordSchema,
        })
        .refine((body) => body.currentPassword !== body.newPassword, {
            path: ["newPassword"],
            message: "New password must be different from the current password",
        }),
});

export type TRegisterPayload = z.infer<typeof registerSchema>["body"];
export type TLoginPayload = z.infer<typeof loginSchema>["body"];
export type TChangePasswordPayload = z.infer<typeof changePasswordSchema>["body"];

export const AuthValidation = {
    passwordSchema,
    emailSchema,
    registerSchema,
    loginSchema,
    refreshTokenSchema,
    changePasswordSchema,
};
