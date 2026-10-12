import type { ZodType } from "zod";
import catchAsync from "../utils/catchAsync";

interface IRequestShape {
    body?: unknown;
    query?: unknown;
    params?: unknown;
}

const validateRequest = (schema: ZodType<IRequestShape>) => {
    return catchAsync(async (req, res, next) => {
        const parsed = await schema.parseAsync({
            body: req.body ?? {},
            query: req.query,
            params: req.params,
        });

        if (parsed.body !== undefined) {
            req.body = parsed.body;
        }

        if (parsed.query !== undefined) {
            res.locals.query = parsed.query;
        }

        next();
    });
};

export default validateRequest;
