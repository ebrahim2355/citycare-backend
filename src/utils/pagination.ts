import type { IMeta } from "./sendResponse";

interface IPaginationQuery {
    page?: number | undefined;
    limit?: number | undefined;
    sortOrder?: "asc" | "desc" | undefined;
}

export const getPagination = (query: IPaginationQuery) => {
    const page = query.page || 1;
    const limit = query.limit || 10;

    return {
        page,
        limit,
        skip: (page - 1) * limit,
        sortOrder: query.sortOrder || "desc",
    };
};

export const getMeta = (page: number, limit: number, total: number): IMeta => {
    return {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
    };
};
