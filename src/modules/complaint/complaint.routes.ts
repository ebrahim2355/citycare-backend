import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import auth from "../../middlewares/auth";
import { uploadImages } from "../../middlewares/upload";
import validateRequest from "../../middlewares/validateRequest";
import { idParamSchema } from "../../validations/common.validation";
import { ComplaintController } from "./complaint.controller";
import { ComplaintValidation } from "./complaint.validation";

const router = Router();

router.post("/", auth(Role.CITIZEN), validateRequest(ComplaintValidation.createComplaintSchema), ComplaintController.createComplaint);
router.get("/", auth(), validateRequest(ComplaintValidation.complaintQuerySchema), ComplaintController.getComplaints);
router.get("/track/:trackingCode", validateRequest(ComplaintValidation.trackingCodeSchema), ComplaintController.trackComplaint);
router.get("/:id", auth(), validateRequest(idParamSchema), ComplaintController.getComplaintById);
router.patch(
    "/:id",
    auth(Role.CITIZEN, Role.ADMIN),
    validateRequest(ComplaintValidation.updateComplaintSchema),
    ComplaintController.updateComplaint
);
router.delete("/:id", auth(Role.CITIZEN, Role.ADMIN), validateRequest(idParamSchema), ComplaintController.deleteComplaint);
router.post(
    "/:id/assign",
    auth(Role.ADMIN),
    validateRequest(ComplaintValidation.assignComplaintSchema),
    ComplaintController.assignComplaint
);
router.patch(
    "/:id/status",
    auth(Role.STAFF, Role.ADMIN),
    validateRequest(ComplaintValidation.changeStatusSchema),
    ComplaintController.changeStatus
);
router.post(
    "/:id/cancel",
    auth(Role.CITIZEN),
    validateRequest(ComplaintValidation.cancelComplaintSchema),
    ComplaintController.cancelComplaint
);
router.post(
    "/:id/reopen",
    auth(Role.CITIZEN),
    validateRequest(ComplaintValidation.reopenComplaintSchema),
    ComplaintController.reopenComplaint
);
router.post(
    "/:id/transfer",
    auth(Role.ADMIN),
    validateRequest(ComplaintValidation.transferComplaintSchema),
    ComplaintController.transferComplaint
);
router.post("/:id/feedback", auth(Role.CITIZEN), validateRequest(ComplaintValidation.feedbackSchema), ComplaintController.submitFeedback);
router.get("/:id/comments", auth(), validateRequest(idParamSchema), ComplaintController.getComments);
router.post("/:id/comments", auth(), validateRequest(ComplaintValidation.addCommentSchema), ComplaintController.addComment);
router.delete(
    "/:id/comments/:commentId",
    auth(),
    validateRequest(ComplaintValidation.commentParamSchema),
    ComplaintController.removeComment
);
router.post("/:id/attachments", auth(), validateRequest(idParamSchema), uploadImages, ComplaintController.addAttachments);
router.delete(
    "/:id/attachments/:attachmentId",
    auth(),
    validateRequest(ComplaintValidation.attachmentParamSchema),
    ComplaintController.removeAttachment
);

export const ComplaintRoutes = router;
