import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { UserService } from "./user.service";

const getMe = catchAsync(async (req, res) => {
    const result = await UserService.getMe(currentUser(req).id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Profile retrieved successfully",
        data: result,
    });
});

const updateProfile = catchAsync(async (req, res) => {
    const result = await UserService.updateProfile(currentUser(req), req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Profile updated successfully",
        data: result,
    });
});

export const UserController = {
    getMe,
    updateProfile,
};
