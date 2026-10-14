import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import { setCacheHeader } from "../../utils/cache";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { StatsService } from "./stats.service";

const getPublicStats = catchAsync(async (_req, res) => {
    const result = await StatsService.getPublicStats();

    setCacheHeader(res, result.cached);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Public statistics retrieved successfully",
        data: result.data,
    });
});

const getAdminStats = catchAsync(async (_req, res) => {
    const result = await StatsService.getAdminStats();

    setCacheHeader(res, result.cached);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Dashboard statistics retrieved successfully",
        data: result.data,
    });
});

const getMyStats = catchAsync(async (req, res) => {
    const result = await StatsService.getMyStats(currentUser(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Your statistics retrieved successfully",
        data: result,
    });
});

export const StatsController = {
    getPublicStats,
    getAdminStats,
    getMyStats,
};
