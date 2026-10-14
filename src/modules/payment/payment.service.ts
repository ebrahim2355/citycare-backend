import { StatusCodes } from "http-status-codes";
import AppError from "../../errors/AppError";
import { type Prisma, Role } from "../../generated/prisma/client";
import prisma from "../../lib/prisma";
import type { IAuthUser } from "../../middlewares/auth";
import { getMeta, getPagination } from "../../utils/pagination";
import { paymentSelect } from "./payment.constant";
import type { TPaymentQuery } from "./payment.validation";

const getPayments = async (user: IAuthUser, query: TPaymentQuery) => {
    const { page, limit, skip, sortOrder } = getPagination(query);

    const where: Prisma.PaymentWhereInput = {
        ...(user.role === Role.CITIZEN ? { citizenId: user.id } : query.citizenId ? { citizenId: query.citizenId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.complaintId ? { complaintId: query.complaintId } : {}),
    };

    const [payments, total] = await prisma.$transaction([
        prisma.payment.findMany({
            where,
            select: paymentSelect,
            orderBy: [{ createdAt: sortOrder }, { id: "asc" }],
            skip,
            take: limit,
        }),
        prisma.payment.count({ where }),
    ]);

    return {
        meta: getMeta(page, limit, total),
        data: payments,
    };
};

const getPaymentById = async (user: IAuthUser, id: string) => {
    const payment = await prisma.payment.findUnique({ where: { id }, select: paymentSelect });

    if (!payment) {
        throw new AppError(StatusCodes.NOT_FOUND, "Payment not found", "No payment found with this id");
    }

    if (user.role === Role.CITIZEN && payment.citizen.id !== user.id) {
        throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only open your own payments");
    }

    return payment;
};

export const PaymentService = {
    getPayments,
    getPaymentById,
};
