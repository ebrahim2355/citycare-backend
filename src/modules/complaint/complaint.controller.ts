import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { ComplaintService } from "./complaint.service";

const createComplaint = catchAsync(async (req, res) => {
    const result = await ComplaintService.createComplaint(currentUser(req), req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        message:
            result.status === "PENDING_PAYMENT"
                ? "Service request created. Pay the service fee to submit it."
                : "Complaint submitted successfully",
        data: result,
    });
});

export const ComplaintController = {
    createComplaint,
};
