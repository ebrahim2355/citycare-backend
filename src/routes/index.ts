import { Router } from "express";
import { StatusCodes } from "http-status-codes";
import { DocsRoutes } from "../docs/docs.routes";
import prisma from "../lib/prisma";
import { getRedisStatus } from "../lib/redis";
import { AdminRoutes } from "../modules/admin/admin.routes";
import { AuthRoutes } from "../modules/auth/auth.routes";
import { CategoryRoutes } from "../modules/category/category.routes";
import { ComplaintRoutes } from "../modules/complaint/complaint.routes";
import { ContactRoutes } from "../modules/contact/contact.routes";
import { DepartmentRoutes } from "../modules/department/department.routes";
import { PaymentRoutes } from "../modules/payment/payment.routes";
import { StatsRoutes } from "../modules/stats/stats.routes";
import { UserRoutes } from "../modules/user/user.routes";
import catchAsync from "../utils/catchAsync";
import sendResponse from "../utils/sendResponse";

const router = Router();

const getDatabaseStatus = async (): Promise<"up" | "down"> => {
    try {
        await prisma.$queryRaw`SELECT 1`;

        return "up";
    } catch {
        return "down";
    }
};

router.get("/health/live", (_req, res) => {
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "API is running",
        data: { uptime: Math.round(process.uptime()) },
    });
});

router.get(
    "/health",
    catchAsync(async (_req, res) => {
        const [database, redis] = await Promise.all([getDatabaseStatus(), getRedisStatus()]);

        if (database === "down") {
            res.status(StatusCodes.SERVICE_UNAVAILABLE).json({
                success: false,
                message: "API is not ready",
                errors: [{ message: "The database is not reachable" }],
            });
            return;
        }

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            message: "API is healthy",
            data: { database, redis, uptime: Math.round(process.uptime()) },
        });
    })
);

const moduleRoutes = [
    { path: "/auth", route: AuthRoutes },
    { path: "/users", route: UserRoutes },
    { path: "/departments", route: DepartmentRoutes },
    { path: "/categories", route: CategoryRoutes },
    { path: "/complaints", route: ComplaintRoutes },
    { path: "/payments", route: PaymentRoutes },
    { path: "/stats", route: StatsRoutes },
    { path: "/contact", route: ContactRoutes },
    { path: "/admin", route: AdminRoutes },
    { path: "/docs", route: DocsRoutes },
];

for (const moduleRoute of moduleRoutes) {
    router.use(moduleRoute.path, moduleRoute.route);
}

export default router;
