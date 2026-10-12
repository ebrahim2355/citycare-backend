import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { ZodError } from "zod";
import config from "../config";
import AppError, { type IErrorItem } from "../errors/AppError";
import { Prisma } from "../generated/prisma/client";

interface IErrorResponse {
    statusCode: number;
    message: string;
    errors: IErrorItem[];
}

const handleZodError = (error: ZodError): IErrorResponse => {
    return {
        statusCode: StatusCodes.BAD_REQUEST,
        message: "Validation failed",
        errors: error.issues.map((issue) => ({
            field: issue.path.slice(1).join(".") || String(issue.path[0] ?? "request"),
            message: issue.message,
        })),
    };
};

const handlePrismaError = (error: Prisma.PrismaClientKnownRequestError): IErrorResponse => {
    if (error.code === "P2002") {
        return {
            statusCode: StatusCodes.CONFLICT,
            message: "Duplicate value",
            errors: [{ message: "A record with this value already exists" }],
        };
    }

    if (error.code === "P2025") {
        return {
            statusCode: StatusCodes.NOT_FOUND,
            message: "Record not found",
            errors: [{ message: "The requested record does not exist" }],
        };
    }

    if (error.code === "P2003") {
        return {
            statusCode: StatusCodes.BAD_REQUEST,
            message: "Invalid reference",
            errors: [{ message: "A related record does not exist" }],
        };
    }

    return {
        statusCode: StatusCodes.BAD_REQUEST,
        message: "Database request failed",
        errors: [{ message: `Database error code ${error.code}` }],
    };
};

const globalErrorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    let response: IErrorResponse = {
        statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
        message: "Something went wrong",
        errors: [{ message: "Internal server error" }],
    };

    if (error instanceof AppError) {
        response = {
            statusCode: error.statusCode,
            message: error.message,
            errors: error.errors,
        };
    } else if (error instanceof ZodError) {
        response = handleZodError(error);
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
        response = handlePrismaError(error);
    } else if (error instanceof Prisma.PrismaClientValidationError) {
        response = {
            statusCode: StatusCodes.BAD_REQUEST,
            message: "Invalid data",
            errors: [{ message: "The provided data does not match the expected format" }],
        };
    } else if (error instanceof SyntaxError && "status" in error && error.status === StatusCodes.BAD_REQUEST) {
        response = {
            statusCode: StatusCodes.BAD_REQUEST,
            message: "Invalid request body",
            errors: [{ message: "Request body must be valid JSON" }],
        };
    } else if (error instanceof Error && "type" in error && error.type === "entity.too.large") {
        response = {
            statusCode: StatusCodes.REQUEST_TOO_LONG,
            message: "Request body is too large",
            errors: [{ message: "Send a smaller request body" }],
        };
    } else if (error instanceof Error) {
        console.error(error);

        if (!config.isProduction) {
            response.errors = [{ message: error.message }];
        }
    }

    res.status(response.statusCode).json({
        success: false,
        message: response.message,
        errors: response.errors,
    });
};

export default globalErrorHandler;
