import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";

const notFound = (req: Request, res: Response) => {
    res.status(StatusCodes.NOT_FOUND).json({
        success: false,
        message: "Route not found",
        errors: [{ message: `${req.method} ${req.originalUrl} does not exist` }],
    });
};

export default notFound;
