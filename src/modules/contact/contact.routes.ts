import { Router } from "express";
import { contactLimiter } from "../../middlewares/rateLimiter";
import validateRequest from "../../middlewares/validateRequest";
import { ContactController } from "./contact.controller";
import { ContactValidation } from "./contact.validation";

const router = Router();

router.post("/", contactLimiter, validateRequest(ContactValidation.createMessageSchema), ContactController.createMessage);

export const ContactRoutes = router;
