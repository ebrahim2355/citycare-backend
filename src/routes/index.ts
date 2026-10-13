import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import prisma from "../lib/prisma";
import { AuthRoutes } from "../modules/auth/auth.routes";
import { CategoryRoutes } from "../modules/category/category.routes";
import { ComplaintRoutes } from "../modules/complaint/complaint.routes";
import { DepartmentRoutes } from "../modules/department/department.routes";
import { UserRoutes } from "../modules/user/user.routes";
import catchAsync from "../utils/catchAsync";
import sendResponse from "../utils/sendResponse";

const router = Router();

router.get(
    "/health",
    catchAsync(async (_req, res) => {
        await prisma.$queryRaw`SELECT 1`;

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            message: "API is healthy",
            data: { database: "up", uptime: Math.round(process.uptime()) },
        });
    })
);

const moduleRoutes = [
    { path: "/auth", route: AuthRoutes },
    { path: "/users", route: UserRoutes },
    { path: "/departments", route: DepartmentRoutes },
    { path: "/categories", route: CategoryRoutes },
    { path: "/complaints", route: ComplaintRoutes },
];

for (const moduleRoute of moduleRoutes) {
    router.use(moduleRoute.path, moduleRoute.route);
}

export default router;
