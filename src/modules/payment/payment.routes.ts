import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";

const router = Router();

router.post("/initiate", auth(Role.CITIZEN), validateRequest(PaymentValidation.initiatePaymentSchema), PaymentController.initiatePayment);
router.post("/webhook", PaymentController.handleWebhook);
router.post("/verify", auth(Role.CITIZEN), validateRequest(PaymentValidation.verifyPaymentSchema), PaymentController.verifyPayment);
router.get("/success", validateRequest(PaymentValidation.callbackQuerySchema), PaymentController.handleSuccess);
router.get("/cancel", validateRequest(PaymentValidation.callbackQuerySchema), PaymentController.handleCancel);

export const PaymentRoutes = router;
