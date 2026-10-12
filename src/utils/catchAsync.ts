import type { NextFunction, Request, RequestHandler, Response } from "express";

const catchAsync = (handler: RequestHandler): RequestHandler => {
    return (req: Request, res: Response, next: NextFunction) => {
        Promise.resolve(handler(req, res, next)).catch(next);
    };
};

export default catchAsync;
