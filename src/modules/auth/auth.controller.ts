import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { NotificationService } from "../notification/notification.service";
import { GoogleAuthService } from "./auth.google";
import { AuthService } from "./auth.service";

const register = catchAsync(async (req, res) => {
    const result = await AuthService.registerUser(req.body, getRequestContext(req));

    await NotificationService.welcome(result.user);

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

const forgotPassword = catchAsync(async (req, res) => {
    const result = await AuthService.requestPasswordReset(req.body.email);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "If an account exists for this email, a password reset email was sent",
        data: result.resetToken ? { resetToken: result.resetToken } : null,
    });
});

const resetPassword = catchAsync(async (req, res) => {
    await AuthService.resetPassword(req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Password reset successfully. Login with your new password.",
    });
});

const googleLogin = catchAsync(async (_req, res) => {
    const url = GoogleAuthService.createLoginUrl(res.locals.query.redirect);

    if (res.locals.query.format === "json") {
        sendResponse(res, {
            statusCode: StatusCodes.OK,
            message: "Open this URL in a browser to login with Google",
            data: { url },
        });
        return;
    }

    res.redirect(url);
});

const googleCallback = catchAsync(async (req, res) => {
    const result = await GoogleAuthService.handleCallback(res.locals.query, getRequestContext(req));

    if (result.redirectTo) {
        res.redirect(result.redirectTo);
        return;
    }

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Google login successful",
        data: result.session,
    });
});

const googleTokenLogin = catchAsync(async (req, res) => {
    const result = await GoogleAuthService.loginWithIdToken(req.body.idToken, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Google login successful",
        data: result,
    });
});

const googleExchange = catchAsync(async (req, res) => {
    const result = await GoogleAuthService.exchangeLoginCode(req.body.code, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Google login successful",
        data: result,
    });
});

export const AuthController = {
    register,
    login,
    refreshToken,
    logout,
    changePassword,
    forgotPassword,
    resetPassword,
    googleLogin,
    googleCallback,
    googleTokenLogin,
    googleExchange,
};
