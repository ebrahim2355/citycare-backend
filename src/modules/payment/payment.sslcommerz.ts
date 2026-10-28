import { StatusCodes } from "http-status-codes";
import config from "../../config";
import AppError from "../../errors/AppError";
import { type PaymentMethod, PaymentProvider, PaymentStatus, type Prisma } from "../../generated/prisma/client";
import logger from "../../lib/logger";
import prisma from "../../lib/prisma";
import getSslCommerz, { type ISslTransaction } from "../../lib/sslcommerz";
import type { IAuthUser } from "../../middlewares/auth";
import { SSL_GATEWAYS, SSL_PAID_STATUSES, STALE_PAYMENT_MINUTES } from "./payment.constant";
import { PaymentSettlement, type TSettleSource } from "./payment.settlement";

type TCloseAs = "CANCELLED" | "FAILED";
type TSyncResult = "paid" | "closed" | "unpaid";
export type TReturnOutcome = "success" | "fail" | "cancel";

const sslPaymentSelect = {
    id: true,
    transactionId: true,
    amount: true,
    currency: true,
    citizenId: true,
    status: true,
    provider: true,
} as const;

type TSslPayment = Prisma.PaymentGetPayload<{ select: typeof sslPaymentSelect }>;

interface ISslCheckoutInput {
    tranId: string;
    method: PaymentMethod;
    clientOrigin: string | null;
    citizen: { name: string; email: string; phone: string | null; address: string | null };
    complaint: { id: string; trackingCode: string; fee: Prisma.Decimal; category: { name: string } };
}

const callbackUrl = (path: string, clientOrigin: string | null) =>
    `${config.appUrl}/api/v1/payments/sslcommerz/${path}${clientOrigin ? `?client=${encodeURIComponent(clientOrigin)}` : ""}`;

const isSettled = (status: PaymentStatus) => status === PaymentStatus.COMPLETED || status === PaymentStatus.REFUNDED;

const createCheckout = async (input: ISslCheckoutInput) => {
    const gateway = SSL_GATEWAYS[input.method];

    const session = await getSslCommerz().createSession({
        tran_id: input.tranId,
        total_amount: input.complaint.fee.toFixed(2),
        currency: config.stripe.currency.toUpperCase(),
        success_url: callbackUrl("success", input.clientOrigin),
        fail_url: callbackUrl("fail", input.clientOrigin),
        cancel_url: callbackUrl("cancel", input.clientOrigin),
        ipn_url: callbackUrl("ipn", null),
        cus_name: input.citizen.name,
        cus_email: input.citizen.email,
        cus_phone: input.citizen.phone || "01700000000",
        cus_add1: input.citizen.address || "Dhaka",
        cus_city: "Dhaka",
        cus_country: "Bangladesh",
        shipping_method: "NO",
        num_of_item: "1",
        product_name: `${input.complaint.category.name} service fee`,
        product_category: "City service",
        product_profile: "non-physical-goods",
        ...(gateway ? { multi_card_name: gateway } : {}),
        value_a: input.complaint.id,
        value_b: input.complaint.trackingCode,
    });

    const direct = session.desc?.find((entry) => entry.gw === gateway)?.redirectGatewayURL;

    return direct || session.GatewayPageURL;
};

const matchesPayment = (transaction: ISslTransaction, payment: TSslPayment) => {
    const currency = (transaction.currency_type || transaction.currency || "").toLowerCase();
    const amount = Number(transaction.currency_type ? transaction.currency_amount : transaction.amount);

    return (
        transaction.tran_id === payment.transactionId &&
        currency === payment.currency.toLowerCase() &&
        Math.abs(amount - Number(payment.amount)) < 0.01
    );
};

const syncPayment = async (payment: TSslPayment, source: TSettleSource, closeAs?: TCloseAs): Promise<TSyncResult> => {
    const ssl = getSslCommerz();
    const transactions = await ssl.findTransactions(payment.transactionId);
    const paid = transactions.find((transaction) => SSL_PAID_STATUSES.includes(transaction.status) && transaction.val_id);

    if (paid) {
        const validation = await ssl.validate(paid.val_id);

        if (!SSL_PAID_STATUSES.includes(validation.status) || !matchesPayment(validation, payment)) {
            logger.error(
                { paymentId: payment.id, status: validation.status, tranId: validation.tran_id },
                "SSLCommerz payment does not match the service fee"
            );

            return "unpaid";
        }

        await PaymentSettlement.settlePaidPayment(
            payment.transactionId,
            {
                validationId: validation.val_id,
                bankTransactionId: validation.bank_tran_id || null,
                chargedAmount: validation.amount,
                chargedCurrency: validation.currency.toLowerCase(),
            },
            source
        );

        return "paid";
    }

    if (!closeAs) {
        return "unpaid";
    }

    const failed = transactions.some((transaction) => transaction.status === "FAILED");

    await PaymentSettlement.closeUnpaidSession(payment.transactionId, failed ? "FAILED" : closeAs);

    return "closed";
};

const findPayment = async (tranId: string) => {
    const payment = await prisma.payment.findUnique({ where: { transactionId: tranId }, select: sslPaymentSelect });

    if (!payment || payment.provider !== PaymentProvider.SSLCOMMERZ) {
        throw new AppError(StatusCodes.NOT_FOUND, "Payment not found", "No bKash or Nagad payment found with this transaction id");
    }

    return payment;
};

const checkPayment = async (payment: TSslPayment, source: TSettleSource, closeAs?: TCloseAs) => {
    return isSettled(payment.status) || (await syncPayment(payment, source, closeAs)) === "paid";
};

const closeForNewCheckout = async (tranId: string) => {
    if (await checkPayment(await findPayment(tranId), "checkout", "CANCELLED")) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Payment is already done",
            "The last checkout of this request was paid, so the request is now submitted."
        );
    }
};

const handleReturn = async (tranId: string, outcome: TReturnOutcome) => {
    const payment = await findPayment(tranId);
    const closeAs = outcome === "fail" ? "FAILED" : outcome === "cancel" ? "CANCELLED" : undefined;
    const paid = await checkPayment(payment, "callback", closeAs);

    return { paid, payment: await PaymentSettlement.getPayment(payment.id) };
};

const handleIpn = async (tranId: string, status: string | undefined) => {
    const payment = await prisma.payment.findUnique({ where: { transactionId: tranId }, select: sslPaymentSelect });

    if (!payment || payment.provider !== PaymentProvider.SSLCOMMERZ) {
        return { received: true, paid: false };
    }

    const closeAs = status === "FAILED" ? "FAILED" : status === "CANCELLED" || status === "EXPIRED" ? "CANCELLED" : undefined;

    return { received: true, paid: await checkPayment(payment, "ipn", closeAs) };
};

const verifyPayment = async (user: IAuthUser, tranId: string) => {
    const payment = await findPayment(tranId);

    if (payment.citizenId !== user.id) {
        throw new AppError(StatusCodes.FORBIDDEN, "Forbidden access", "You can only verify your own payments");
    }

    const paid = await checkPayment(payment, "verify");

    return { paid, payment: await PaymentSettlement.getPayment(payment.id) };
};

const handleSuccessCallback = async (tranId: string) => {
    const payment = await findPayment(tranId);

    if (!(await checkPayment(payment, "callback"))) {
        throw new AppError(
            StatusCodes.CONFLICT,
            "Payment is not completed",
            "SSLCommerz has not received the payment for this transaction yet"
        );
    }

    return PaymentSettlement.getPayment(payment.id);
};

const handleCancelCallback = async (tranId: string) => {
    const payment = await findPayment(tranId);
    const paid = await checkPayment(payment, "callback", "CANCELLED");

    return { paid, payment: await PaymentSettlement.getPayment(payment.id) };
};

const reconcileStalePayments = async (now = new Date()) => {
    const stale = await prisma.payment.findMany({
        where: {
            provider: PaymentProvider.SSLCOMMERZ,
            status: PaymentStatus.PENDING,
            createdAt: { lt: new Date(now.getTime() - STALE_PAYMENT_MINUTES * 60 * 1000) },
        },
        orderBy: { createdAt: "asc" },
        take: 100,
        select: sslPaymentSelect,
    });

    const result = { checked: stale.length, settled: 0, closed: 0, failed: 0 };

    for (const payment of stale) {
        try {
            const synced = await syncPayment(payment, "job", "CANCELLED");

            if (synced === "paid") {
                result.settled++;
            } else if (synced === "closed") {
                result.closed++;
            }
        } catch (error) {
            result.failed++;
            logger.error({ err: error, paymentId: payment.id }, "Stale SSLCommerz payment check failed");
        }
    }

    return result;
};

export const PaymentSslCommerz = {
    createCheckout,
    closeForNewCheckout,
    handleReturn,
    handleIpn,
    verifyPayment,
    handleSuccessCallback,
    handleCancelCallback,
    reconcileStalePayments,
};
