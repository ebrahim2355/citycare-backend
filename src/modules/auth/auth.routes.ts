import { Router } from "express";
import { authLimiter } from "../../middlewares/rateLimiter";
import validateRequest from "../../middlewares/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthValidation } from "./auth.validation";

const router = Router();

router.post("/register", authLimiter, validateRequest(AuthValidation.registerSchema), AuthController.register);
router.post("/login", authLimiter, validateRequest(AuthValidation.loginSchema), AuthController.login);

export const AuthRoutes = router;
