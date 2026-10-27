import { Router } from "express";
import cronAuth from "../../middlewares/cronAuth";
import { JobsController } from "./jobs.controller";

const router = Router();

router.get("/sla-check", cronAuth, JobsController.runSlaCheck);

export const JobsRoutes = router;
