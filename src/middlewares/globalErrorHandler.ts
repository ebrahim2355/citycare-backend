import type { NextFunction, Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import { MulterError } from "multer";
import Stripe from "stripe";
import { ZodError } from "zod";
import config from "../config";
import AppError, { type IErrorItem } from "../errors/AppError";
import { Prisma } from "../generated/prisma/client";
import { IMAGE_FIELD, MAX_IMAGE_BYTES, MAX_IMAGES_PER_REQUEST } from "./upload";

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

const handleStripeError = (error: Stripe.errors.StripeError): IErrorResponse => {
    let statusCode: number = StatusCodes.BAD_GATEWAY;

    if (error.type === "StripeCardError") {
        statusCode = StatusCodes.PAYMENT_REQUIRED;
    } else if (error.type === "StripeInvalidRequestError") {
        statusCode = StatusCodes.BAD_REQUEST;
    }

    return {
        statusCode,
        message: "Payment provider error",
        errors: [{ message: error.message }],
    };
};

const handleUploadError = (error: MulterError): IErrorResponse => {
    const messages: Partial<Record<MulterError["code"], string>> = {
        LIMIT_FILE_SIZE: `Each image can be ${MAX_IMAGE_BYTES / 1024 / 1024} MB at most`,
        LIMIT_FILE_COUNT: `You can upload ${MAX_IMAGES_PER_REQUEST} images in one request`,
        LIMIT_UNEXPECTED_FILE: `Send the images in the "${IMAGE_FIELD}" field, ${MAX_IMAGES_PER_REQUEST} at most in one request`,
    };

    return {
        statusCode: error.code === "LIMIT_FILE_SIZE" ? StatusCodes.REQUEST_TOO_LONG : StatusCodes.BAD_REQUEST,
        message: "Image upload failed",
        errors: [{ field: IMAGE_FIELD, message: messages[error.code] ?? error.message }],
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
    } else if (error instanceof Stripe.errors.StripeError) {
        response = handleStripeError(error);
    } else if (error instanceof MulterError) {
        response = handleUploadError(error);
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
        res.err = error;

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
