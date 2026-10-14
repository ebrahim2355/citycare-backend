import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { idParamSchema } from "../../validations/common.validation";
import { ComplaintController } from "./complaint.controller";
import { ComplaintValidation } from "./complaint.validation";

const router = Router();

router.post("/", auth(Role.CITIZEN), validateRequest(ComplaintValidation.createComplaintSchema), ComplaintController.createComplaint);
router.get("/", auth(), validateRequest(ComplaintValidation.complaintQuerySchema), ComplaintController.getComplaints);
router.get("/track/:trackingCode", validateRequest(ComplaintValidation.trackingCodeSchema), ComplaintController.trackComplaint);
router.get("/:id", auth(), validateRequest(idParamSchema), ComplaintController.getComplaintById);

export const ComplaintRoutes = router;
