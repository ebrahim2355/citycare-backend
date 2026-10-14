import { StatusCodes } from "http-status-codes";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { AuditService } from "./audit.service";

const getAuditLogs = catchAsync(async (_req, res) => {
    const result = await AuditService.getAuditLogs(res.locals.query);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Audit logs retrieved successfully",
        meta: result.meta,
        data: result.data,
    });
});

export const AuditController = {
    getAuditLogs,
};
