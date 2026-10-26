import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { Inbox } from "./notification.inbox";

const getNotifications = catchAsync(async (req, res) => {
    const result = await Inbox.getNotifications(currentUser(req), res.locals.query);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Notifications retrieved successfully",
        meta: result.meta,
        data: result.data,
    });
});

const getUnreadCount = catchAsync(async (req, res) => {
    const result = await Inbox.getUnreadCount(currentUser(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Unread notifications counted",
        data: result,
    });
});

const markRead = catchAsync(async (req, res) => {
    const result = await Inbox.markRead(currentUser(req), req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Notification marked as read",
        data: result,
    });
});

const markAllRead = catchAsync(async (req, res) => {
    const result = await Inbox.markAllRead(currentUser(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: `${result.count} notification${result.count === 1 ? "" : "s"} marked as read`,
        data: result,
    });
});

export const NotificationController = {
    getNotifications,
    getUnreadCount,
    markRead,
    markAllRead,
};
