import { z } from "zod";
import { paginationFields, uuidSchema } from "../../validations/common.validation";

const notificationQuerySchema = z.object({
    query: z.object({
        page: paginationFields.page,
        limit: paginationFields.limit,
        unread: z.enum(["true", "false"], "unread must be true or false").optional(),
    }),
});

const notificationParamSchema = z.object({
    params: z.object({
        id: uuidSchema(),
    }),
});

export type TNotificationQuery = z.infer<typeof notificationQuerySchema>["query"];

export const NotificationValidation = {
    notificationQuerySchema,
    notificationParamSchema,
};
