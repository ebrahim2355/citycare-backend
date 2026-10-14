import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { ComplaintAssignment } from "./complaint.assignment";
import { ComplaintService } from "./complaint.service";
import { ComplaintWorkflow } from "./complaint.workflow";

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

const getComplaints = catchAsync(async (req, res) => {
    const result = await ComplaintService.getComplaints(currentUser(req), res.locals.query);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Complaints retrieved successfully",
        meta: result.meta,
        data: result.data,
    });
});

const getComplaintById = catchAsync(async (req, res) => {
    const result = await ComplaintService.getComplaintById(currentUser(req), req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Complaint retrieved successfully",
        data: result,
    });
});

const trackComplaint = catchAsync(async (req, res) => {
    const result = await ComplaintService.trackComplaint(req.params.trackingCode as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Tracking details retrieved successfully",
        data: result,
    });
});

const updateComplaint = catchAsync(async (req, res) => {
    const result = await ComplaintService.updateComplaint(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Complaint updated successfully",
        data: result,
    });
});

const deleteComplaint = catchAsync(async (req, res) => {
    await ComplaintService.deleteComplaint(currentUser(req), req.params.id as string, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Complaint removed successfully",
    });
});

const assignComplaint = catchAsync(async (req, res) => {
    const result = await ComplaintAssignment.assignComplaint(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: `Complaint assigned to ${result.assignedStaff?.name}`,
        data: result,
    });
});

const changeStatus = catchAsync(async (req, res) => {
    const result = await ComplaintWorkflow.changeStatus(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: `Complaint status changed to ${result.status}`,
        data: result,
    });
});

const cancelComplaint = catchAsync(async (req, res) => {
    const result = await ComplaintWorkflow.cancelComplaint(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Complaint cancelled successfully",
        data: result,
    });
});

const reopenComplaint = catchAsync(async (req, res) => {
    const result = await ComplaintWorkflow.reopenComplaint(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Complaint reopened successfully",
        data: result,
    });
});

const transferComplaint = catchAsync(async (req, res) => {
    const result = await ComplaintWorkflow.transferComplaint(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: `Complaint transferred to ${result.department.name}`,
        data: result,
    });
});

const submitFeedback = catchAsync(async (req, res) => {
    const result = await ComplaintWorkflow.submitFeedback(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        message: "Thank you for your feedback",
        data: result,
    });
});

export const ComplaintController = {
    submitFeedback,
    createComplaint,
    getComplaints,
    getComplaintById,
    trackComplaint,
    updateComplaint,
    deleteComplaint,
    assignComplaint,
    changeStatus,
    cancelComplaint,
    reopenComplaint,
    transferComplaint,
};
