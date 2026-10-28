import { PaymentMethod, PaymentProvider } from "../../generated/prisma/client";

export const paymentSelect = {
    id: true,
    amount: true,
    currency: true,
    provider: true,
    method: true,
    status: true,
    transactionId: true,
    chargedAmount: true,
    chargedCurrency: true,
    paidAt: true,
    refundedAt: true,
    createdAt: true,
    updatedAt: true,
    complaint: {
        select: {
            id: true,
            trackingCode: true,
            title: true,
            status: true,
            paymentStatus: true,
            category: { select: { id: true, name: true } },
        },
    },
    citizen: { select: { id: true, name: true, email: true } },
} as const;

export const CHECKOUT_MINUTES = 31;

export const STALE_PAYMENT_MINUTES = 45;

export const PROVIDER_BY_METHOD: Record<PaymentMethod, PaymentProvider> = {
    [PaymentMethod.CARD]: PaymentProvider.STRIPE,
    [PaymentMethod.BKASH]: PaymentProvider.SSLCOMMERZ,
    [PaymentMethod.NAGAD]: PaymentProvider.SSLCOMMERZ,
};

export const METHOD_LABELS: Record<PaymentMethod, string> = {
    [PaymentMethod.CARD]: "Card",
    [PaymentMethod.BKASH]: "bKash",
    [PaymentMethod.NAGAD]: "Nagad",
};

export const SSL_GATEWAYS: Partial<Record<PaymentMethod, string>> = {
    [PaymentMethod.BKASH]: "bkash",
    [PaymentMethod.NAGAD]: "nagad",
};

export const SSL_PAID_STATUSES = ["VALID", "VALIDATED"];

export const SSL_TRAN_ID_PATTERN = /^CC[0-9A-F]{24}$/;
