import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { DepartmentService } from "./department.service";

const getAllDepartments = catchAsync(async (_req, res) => {
    const result = await DepartmentService.getAllDepartments();

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Departments retrieved successfully",
        data: result,
    });
});

const getDepartmentById = catchAsync(async (req, res) => {
    const result = await DepartmentService.getDepartmentById(req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Department retrieved successfully",
        data: result,
    });
});

const createDepartment = catchAsync(async (req, res) => {
    const result = await DepartmentService.createDepartment(currentUser(req).id, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        message: "Department created successfully",
        data: result,
    });
});

const updateDepartment = catchAsync(async (req, res) => {
    const result = await DepartmentService.updateDepartment(currentUser(req).id, req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Department updated successfully",
        data: result,
    });
});

const deleteDepartment = catchAsync(async (req, res) => {
    await DepartmentService.deleteDepartment(currentUser(req).id, req.params.id as string, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Department removed successfully",
    });
});

export const DepartmentController = {
    getAllDepartments,
    getDepartmentById,
    createDepartment,
    updateDepartment,
    deleteDepartment,
};
