import { Router } from "express";
import auth from "../../middlewares/auth";
import { authLimiter } from "../../middlewares/rateLimiter";
import validateRequest from "../../middlewares/validateRequest";
import { AuthController } from "./auth.controller";
import { AuthValidation } from "./auth.validation";

const router = Router();

router.post("/register", authLimiter, validateRequest(AuthValidation.registerSchema), AuthController.register);
router.post("/login", authLimiter, validateRequest(AuthValidation.loginSchema), AuthController.login);
router.post("/refresh-token", authLimiter, validateRequest(AuthValidation.refreshTokenSchema), AuthController.refreshToken);
router.post("/logout", validateRequest(AuthValidation.refreshTokenSchema), AuthController.logout);
router.post("/change-password", auth(), validateRequest(AuthValidation.changePasswordSchema), AuthController.changePassword);

export const AuthRoutes = router;
