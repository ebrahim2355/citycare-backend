export const paymentSelect = {
    id: true,
    amount: true,
    currency: true,
    provider: true,
    status: true,
    transactionId: true,
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
