import { Router } from "express";
import { Role } from "../../generated/prisma/client";
import auth, { optionalAuth } from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { idParamSchema } from "../../validations/common.validation";
import { CategoryController } from "./category.controller";
import { CategoryValidation } from "./category.validation";

const router = Router();

router.get("/", optionalAuth, validateRequest(CategoryValidation.categoryQuerySchema), CategoryController.getAllCategories);
router.get("/:id", validateRequest(idParamSchema), CategoryController.getCategoryById);
router.post("/", auth(Role.ADMIN), validateRequest(CategoryValidation.createCategorySchema), CategoryController.createCategory);
router.patch("/:id", auth(Role.ADMIN), validateRequest(CategoryValidation.updateCategorySchema), CategoryController.updateCategory);
router.delete("/:id", auth(Role.ADMIN), validateRequest(idParamSchema), CategoryController.deleteCategory);

export const CategoryRoutes = router;
