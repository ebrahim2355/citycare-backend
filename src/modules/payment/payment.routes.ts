import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { PaymentController } from "./payment.controller";
import { PaymentValidation } from "./payment.validation";

const router = Router();

router.post("/initiate", auth(Role.CITIZEN), validateRequest(PaymentValidation.initiatePaymentSchema), PaymentController.initiatePayment);

export const PaymentRoutes = router;
