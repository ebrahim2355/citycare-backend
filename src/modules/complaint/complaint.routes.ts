import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { ComplaintController } from "./complaint.controller";
import { ComplaintValidation } from "./complaint.validation";

const router = Router();

router.post("/", auth(Role.CITIZEN), validateRequest(ComplaintValidation.createComplaintSchema), ComplaintController.createComplaint);

export const ComplaintRoutes = router;
