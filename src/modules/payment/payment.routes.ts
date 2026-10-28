import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { idParamSchema } from "../../validations/common.validation";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";

const router = Router();

router.get("/methods", PaymentController.getMethods);
router.post("/initiate", auth(Role.CITIZEN), validateRequest(PaymentValidation.initiatePaymentSchema), PaymentController.initiatePayment);
router.post("/webhook", PaymentController.handleWebhook);
router.post("/sslcommerz/success", validateRequest(PaymentValidation.sslReturnSchema), PaymentController.sslSuccess);
router.post("/sslcommerz/fail", validateRequest(PaymentValidation.sslReturnSchema), PaymentController.sslFail);
router.post("/sslcommerz/cancel", validateRequest(PaymentValidation.sslReturnSchema), PaymentController.sslCancel);
router.post("/sslcommerz/ipn", validateRequest(PaymentValidation.sslIpnSchema), PaymentController.handleSslIpn);
router.post("/verify", auth(Role.CITIZEN), validateRequest(PaymentValidation.verifyPaymentSchema), PaymentController.verifyPayment);
router.get("/success", validateRequest(PaymentValidation.callbackQuerySchema), PaymentController.handleSuccess);
router.get("/cancel", validateRequest(PaymentValidation.callbackQuerySchema), PaymentController.handleCancel);
router.get("/", auth(Role.CITIZEN, Role.ADMIN), validateRequest(PaymentValidation.paymentQuerySchema), PaymentController.getPayments);
router.get("/:id", auth(Role.CITIZEN, Role.ADMIN), validateRequest(idParamSchema), PaymentController.getPaymentById);
router.post("/:id/refund", auth(Role.ADMIN), validateRequest(idParamSchema), PaymentController.refundPayment);

export const PaymentRoutes = router;
