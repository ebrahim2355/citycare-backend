import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { idParamSchema } from "../../validations/common.validation";
import { DepartmentController } from "./department.controller";
import { DepartmentValidation } from "./department.validation";

const router = Router();

router.get("/", DepartmentController.getAllDepartments);
router.get("/:id", validateRequest(idParamSchema), DepartmentController.getDepartmentById);
router.post("/", auth(Role.ADMIN), validateRequest(DepartmentValidation.createDepartmentSchema), DepartmentController.createDepartment);
router.patch("/:id", auth(Role.ADMIN), validateRequest(DepartmentValidation.updateDepartmentSchema), DepartmentController.updateDepartment);
router.delete("/:id", auth(Role.ADMIN), validateRequest(idParamSchema), DepartmentController.deleteDepartment);

export const DepartmentRoutes = router;
