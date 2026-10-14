import { z } from "zod";
import { paginationFields, uuidSchema } from "../../validations/common.validation";

const priorities = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const statuses = ["PENDING_PAYMENT", "SUBMITTED", "ASSIGNED", "IN_PROGRESS", "RESOLVED", "CLOSED", "REJECTED", "CANCELLED"] as const;
const booleanText = (label: string) => z.enum(["true", "false"], `${label} must be true or false`);

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

const complaintQuerySchema = z.object({
    query: z
        .object({
            ...paginationFields,
            sortBy: z
                .enum(
                    ["createdAt", "updatedAt", "dueAt", "priority", "status"],
                    "sortBy must be createdAt, updatedAt, dueAt, priority or status"
                )
                .optional(),
            status: z.enum(statuses, "status is not valid").optional(),
            priority: complaintFields.priority.optional(),
            type: z.enum(["COMPLAINT", "SERVICE"], "type must be COMPLAINT or SERVICE").optional(),
            paymentStatus: z.enum(["NOT_REQUIRED", "UNPAID", "PAID", "REFUNDED"], "paymentStatus is not valid").optional(),
            categoryId: uuidSchema("categoryId").optional(),
            departmentId: uuidSchema("departmentId").optional(),
            citizenId: uuidSchema("citizenId").optional(),
            assignedStaffId: uuidSchema("assignedStaffId").optional(),
            unassigned: booleanText("unassigned").optional(),
            overdue: booleanText("overdue").optional(),
            area: z.string().trim().max(80, "area is too long").optional(),
            searchTerm: z.string().trim().max(100, "searchTerm is too long").optional(),
            from: z.coerce.date("from must be a valid date").optional(),
            to: z.coerce.date("to must be a valid date").optional(),
        })
        .refine((query) => !query.from || !query.to || query.from <= query.to, {
            path: ["to"],
            message: "to must be the same as or after from",
        }),
});

const trackingCodeSchema = z.object({
    params: z.object({
        trackingCode: z
            .string()
            .trim()
            .regex(/^CC-\d{6}-[A-Z0-9]{6}$/i, "Tracking code is not valid"),
    }),
});

const updateComplaintSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z
        .object({
            title: complaintFields.title.optional(),
            description: complaintFields.description.optional(),
            address: complaintFields.address.optional(),
            area: complaintFields.area.optional(),
            priority: complaintFields.priority.optional(),
            latitude: complaintFields.latitude.optional(),
            longitude: complaintFields.longitude.optional(),
        })
        .refine((body) => Object.keys(body).length > 0, "Send at least one field to update")
        .refine(hasBothCoordinates, { path: ["longitude"], message: "Send latitude and longitude together" }),
});

const assignComplaintSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z.object({
        staffId: uuidSchema("staffId").optional(),
        note: z
            .string()
            .trim()
            .min(3, "note must be at least 3 characters")
            .max(300, "note cannot be longer than 300 characters")
            .optional(),
    }),
});

const changeStatusSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z
        .object({
            status: z.enum(["IN_PROGRESS", "RESOLVED", "REJECTED", "CLOSED"], "status must be IN_PROGRESS, RESOLVED, REJECTED or CLOSED"),
            note: z
                .string()
                .trim()
                .min(10, "note must be at least 10 characters")
                .max(1000, "note cannot be longer than 1000 characters")
                .optional(),
        })
        .refine((body) => !["RESOLVED", "REJECTED"].includes(body.status) || Boolean(body.note), {
            path: ["note"],
            message: "A note is required when a complaint is resolved or rejected",
        }),
});

const cancelComplaintSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z.object({
        reason: z
            .string()
            .trim()
            .min(5, "reason must be at least 5 characters")
            .max(300, "reason cannot be longer than 300 characters")
            .optional(),
    }),
});

const reopenComplaintSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z.object({
        reason: z
            .string("reason is required")
            .trim()
            .min(10, "reason must be at least 10 characters")
            .max(500, "reason cannot be longer than 500 characters"),
    }),
});

const transferComplaintSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z.object({
        departmentId: uuidSchema("departmentId"),
        note: z
            .string()
            .trim()
            .min(3, "note must be at least 3 characters")
            .max(300, "note cannot be longer than 300 characters")
            .optional(),
    }),
});

const feedbackSchema = z.object({
    params: z.object({ id: uuidSchema() }),
    body: z.object({
        rating: z
            .number("rating must be a number from 1 to 5")
            .int("rating must be a whole number")
            .min(1, "rating must be at least 1")
            .max(5, "rating cannot be more than 5"),
        comment: z.string().trim().max(500, "comment cannot be longer than 500 characters").optional(),
    }),
});

export type TCreateComplaintPayload = z.infer<typeof createComplaintSchema>["body"];
export type TFeedbackPayload = z.infer<typeof feedbackSchema>["body"];
export type TComplaintQuery = z.infer<typeof complaintQuerySchema>["query"];
export type TUpdateComplaintPayload = z.infer<typeof updateComplaintSchema>["body"];
export type TAssignComplaintPayload = z.infer<typeof assignComplaintSchema>["body"];
export type TChangeStatusPayload = z.infer<typeof changeStatusSchema>["body"];
export type TCancelComplaintPayload = z.infer<typeof cancelComplaintSchema>["body"];
export type TReopenComplaintPayload = z.infer<typeof reopenComplaintSchema>["body"];
export type TTransferComplaintPayload = z.infer<typeof transferComplaintSchema>["body"];

export const ComplaintValidation = {
    createComplaintSchema,
    complaintQuerySchema,
    trackingCodeSchema,
    updateComplaintSchema,
    assignComplaintSchema,
    changeStatusSchema,
    cancelComplaintSchema,
    reopenComplaintSchema,
    transferComplaintSchema,
    feedbackSchema,
};

export const complaintValidationParts = {
    priorities,
    statuses,
    complaintFields,
    hasBothCoordinates,
};
