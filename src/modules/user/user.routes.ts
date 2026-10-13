import { Router } from "express";
import auth from "../../middlewares/auth";
import validateRequest from "../../middlewares/validateRequest";
import { UserController } from "./user.controller";
import { UserValidation } from "./user.validation";

const router = Router();

router.get("/me", auth(), UserController.getMe);
router.patch("/me", auth(), validateRequest(UserValidation.updateProfileSchema), UserController.updateProfile);

export const UserRoutes = router;
