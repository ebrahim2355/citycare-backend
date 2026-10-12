import type { Response } from "express";

export interface IMeta {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
}

interface IResponsePayload<T> {
    statusCode: number;
    message: string;
    meta?: IMeta;
    data?: T;
}

const sendResponse = <T>(res: Response, payload: IResponsePayload<T>) => {
    res.status(payload.statusCode).json({
        success: true,
        message: payload.message,
        meta: payload.meta,
        data: payload.data ?? null,
    });
};

export default sendResponse;
