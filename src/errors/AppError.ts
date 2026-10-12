export interface IErrorItem {
    field?: string;
    message: string;
}

class AppError extends Error {
    statusCode: number;
    errors: IErrorItem[];

    constructor(statusCode: number, message: string, errors?: string | IErrorItem[]) {
        super(message);
        this.statusCode = statusCode;
        this.errors = typeof errors === "string" ? [{ message: errors }] : (errors ?? [{ message }]);
    }
}

export default AppError;
