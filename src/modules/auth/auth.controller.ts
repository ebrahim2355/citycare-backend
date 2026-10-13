import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { AuthService } from "./auth.service";

const register = catchAsync(async (req, res) => {
    const result = await AuthService.registerUser(req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        message: "User registered successfully",
        data: result,
    });
});

const login = catchAsync(async (req, res) => {
    const result = await AuthService.loginUser(req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Login successful",
        data: result,
    });
});

const refreshToken = catchAsync(async (req, res) => {
    const result = await AuthService.refreshAccessToken(req.body.refreshToken, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Token refreshed successfully",
        data: result,
    });
});

const logout = catchAsync(async (req, res) => {
    await AuthService.logoutUser(req.body.refreshToken);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Logged out successfully",
    });
});

const changePassword = catchAsync(async (req, res) => {
    const result = await AuthService.changePassword(currentUser(req).id, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Password changed successfully",
        data: result,
    });
});

export const AuthController = {
    register,
    login,
    refreshToken,
    logout,
    changePassword,
};
