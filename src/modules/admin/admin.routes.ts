import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { idParamSchema } from "../../validations/common.validation";
import { AuditController } from "../audit/audit.controller";
import { AuditValidation } from "../audit/audit.validation";
import { ContactController } from "../contact/contact.controller";
import { ContactValidation } from "../contact/contact.validation";
import { JobsController } from "../jobs/jobs.controller";
import { StatsController } from "../stats/stats.controller";
import { AdminController } from "./admin.controller";
import { AdminValidation } from "./admin.validation";

const router = Router();

router.use(auth(Role.ADMIN));

router.get("/users", validateRequest(AdminValidation.userQuerySchema), AdminController.getAllUsers);
router.post("/users", validateRequest(AdminValidation.createUserSchema), AdminController.createUser);
router.patch("/users/:id/role", validateRequest(AdminValidation.updateRoleSchema), AdminController.updateUserRole);
router.patch("/users/:id/status", validateRequest(AdminValidation.updateStatusSchema), AdminController.updateUserStatus);
router.delete("/users/:id", validateRequest(idParamSchema), AdminController.deleteUser);
router.get("/staff-workload", validateRequest(AdminValidation.staffQuerySchema), AdminController.getStaffWorkload);
router.get("/dashboard-stats", StatsController.getAdminStats);
router.post("/sla-check", JobsController.runSlaCheck);
router.get("/audit-logs", validateRequest(AuditValidation.auditLogQuerySchema), AuditController.getAuditLogs);
router.get("/messages", validateRequest(ContactValidation.messageQuerySchema), ContactController.getMessages);
router.post("/messages/:id/reply", validateRequest(ContactValidation.replySchema), ContactController.replyToMessage);
router.patch("/messages/:id/status", validateRequest(ContactValidation.updateStatusSchema), ContactController.updateMessageStatus);

export const AdminRoutes = router;
