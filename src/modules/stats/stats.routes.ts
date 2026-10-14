import { Router } from "express";
import auth from "../../middlewares/auth";
import { StatsController } from "./stats.controller";

const router = Router();

router.get("/public", StatsController.getPublicStats);
router.get("/me", auth(), StatsController.getMyStats);

export const StatsRoutes = router;
