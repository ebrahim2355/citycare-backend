import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { AdminService } from "./admin.service";

const getAllUsers = catchAsync(async (_req, res) => {
    const result = await AdminService.getAllUsers(res.locals.query);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Users retrieved successfully",
        meta: result.meta,
        data: result.data,
    });
});

const createUser = catchAsync(async (req, res) => {
    const result = await AdminService.createUser(currentUser(req), req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        message: `${result.role === "STAFF" ? "Staff" : "Admin"} account created successfully`,
        data: result,
    });
});

const updateUserRole = catchAsync(async (req, res) => {
    const result = await AdminService.updateUserRole(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: `User role changed to ${result.role}`,
        data: result,
    });
});

const updateUserStatus = catchAsync(async (req, res) => {
    const result = await AdminService.updateUserStatus(currentUser(req), req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: result.status === "BLOCKED" ? "User blocked successfully" : "User unblocked successfully",
        data: result,
    });
});

const deleteUser = catchAsync(async (req, res) => {
    await AdminService.deleteUser(currentUser(req), req.params.id as string, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "User removed successfully",
    });
});

const getStaffWorkload = catchAsync(async (_req, res) => {
    const result = await AdminService.getStaffWorkload(res.locals.query);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Staff workload retrieved successfully",
        data: result,
    });
});

export const AdminController = {
    getAllUsers,
    createUser,
    updateUserRole,
    updateUserStatus,
    deleteUser,
    getStaffWorkload,
};
