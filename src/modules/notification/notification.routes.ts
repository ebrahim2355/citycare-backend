import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { NotificationController } from "./notification.controller";
import { NotificationValidation } from "./notification.validation";

const router = Router();

router.use(auth());

router.get("/", validateRequest(NotificationValidation.notificationQuerySchema), NotificationController.getNotifications);
router.get("/unread-count", NotificationController.getUnreadCount);
router.patch("/read-all", NotificationController.markAllRead);
router.patch("/:id/read", validateRequest(NotificationValidation.notificationParamSchema), NotificationController.markRead);

export const NotificationRoutes = router;
