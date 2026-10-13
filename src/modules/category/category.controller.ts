import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { CategoryService } from "./category.service";

const getAllCategories = catchAsync(async (req, res) => {
    const result = await CategoryService.getAllCategories(res.locals.query, req.user);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Categories retrieved successfully",
        data: result,
    });
});

const getCategoryById = catchAsync(async (req, res) => {
    const result = await CategoryService.getCategoryById(req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Category retrieved successfully",
        data: result,
    });
});

const createCategory = catchAsync(async (req, res) => {
    const result = await CategoryService.createCategory(currentUser(req).id, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.CREATED,
        message: "Category created successfully",
        data: result,
    });
});

const updateCategory = catchAsync(async (req, res) => {
    const result = await CategoryService.updateCategory(currentUser(req).id, req.params.id as string, req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Category updated successfully",
        data: result,
    });
});

const deleteCategory = catchAsync(async (req, res) => {
    await CategoryService.deleteCategory(currentUser(req).id, req.params.id as string, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Category removed successfully",
    });
});

export const CategoryController = {
    getAllCategories,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
};
