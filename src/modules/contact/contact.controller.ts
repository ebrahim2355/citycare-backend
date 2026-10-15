import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { ContactService } from "./contact.service";

const createMessage = catchAsync(async (req, res) => {
    const result = await ContactService.createMessage(req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        message: "Thank you. Your message was sent to the city team.",
        data: result,
    });
});

const getMessages = catchAsync(async (_req, res) => {
    const result = await ContactService.getMessages(res.locals.query);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Messages retrieved successfully",
        meta: result.meta,
        data: result.data,
    });
});

const replyToMessage = catchAsync(async (req, res) => {
    const result = await ContactService.replyToMessage(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: result.emailSent ? "Reply sent by email" : "Reply saved, but the email could not be sent",
        data: result,
    });
});

const updateMessageStatus = catchAsync(async (req, res) => {
    const result = await ContactService.updateMessageStatus(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Message status updated successfully",
        data: result,
    });
});

export const ContactController = {
    createMessage,
    getMessages,
    replyToMessage,
    updateMessageStatus,
};
