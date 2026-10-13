import { z } from "zod";
import { uuidSchema } from "../../validations/common.validation";

const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

const complaintFields = {
    title: z
        .string("Title is required")
        .trim()
        .min(5, "Title must be at least 5 characters")
        .max(120, "Title cannot be longer than 120 characters"),
    description: z
        .string("Description is required")
        .trim()
        .min(10, "Description must be at least 10 characters")
        .max(2000, "Description cannot be longer than 2000 characters"),
    address: z
        .string("Address is required")
        .trim()
        .min(5, "Address must be at least 5 characters")
        .max(200, "Address cannot be longer than 200 characters"),
    area: z
        .string("Area is required")
        .trim()
        .min(2, "Area must be at least 2 characters")
        .max(80, "Area cannot be longer than 80 characters"),
    priority: z.enum(priorities, "priority must be LOW, MEDIUM, HIGH or URGENT"),
    latitude: z
        .number("latitude must be a number")
        .min(-90, "latitude must be between -90 and 90")
        .max(90, "latitude must be between -90 and 90"),
    longitude: z
        .number("longitude must be a number")
        .min(-180, "longitude must be between -180 and 180")
        .max(180, "longitude must be between -180 and 180"),
};

const hasBothCoordinates = (body: { latitude?: number | undefined; longitude?: number | undefined }) => {
    return (body.latitude === undefined) === (body.longitude === undefined);
};

const createComplaintSchema = z.object({
    body: z
        .object({
            title: complaintFields.title,
            description: complaintFields.description,
            categoryId: uuidSchema("categoryId"),
            address: complaintFields.address,
            area: complaintFields.area,
            priority: complaintFields.priority.default("MEDIUM"),
            latitude: complaintFields.latitude.optional(),
            longitude: complaintFields.longitude.optional(),
        })
        .refine(hasBothCoordinates, { path: ["longitude"], message: "Send latitude and longitude together" }),
});

export type TCreateComplaintPayload = z.infer<typeof createComplaintSchema>["body"];

export const ComplaintValidation = {
    createComplaintSchema,
};

export const complaintValidationParts = {
    priorities,
    complaintFields,
    hasBothCoordinates,
};
