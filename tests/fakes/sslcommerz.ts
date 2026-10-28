import { randomBytes } from "node:crypto";
import { StatusCodes } from "http-status-codes";
import { vi } from "vitest";
import AppError from "../../src/errors/AppError";
import type { ISslCommerz, ISslRefundRequest, ISslSession, ISslTransaction } from "../../src/lib/sslcommerz";

type TFakeStatus = "PROCESSING" | "VALID" | "VALIDATED" | "FAILED" | "CANCELLED";

interface IFakeSession {
    tranId: string;
    fields: Record<string, string>;
    status: TFakeStatus;
    valId: string;
    bankTranId: string;
    cardType: string;
    currencyAmount: string;
    refundRef: string | null;
}

export const BDT_RATE = 120;

const sessions = new Map<string, IFakeSession>();
let ready = true;
let withGateways = true;
let refundError: string | null = null;

const key = () => randomBytes(10).toString("hex").toUpperCase();

const findSession = (tranId: string) => {
    const session = sessions.get(tranId);

    if (!session) {
        throw new Error(`No fake SSLCommerz session for ${tranId}`);
    }

    return session;
};

const transactionOf = (session: IFakeSession): ISslTransaction => ({
    status: session.status,
    tran_id: session.tranId,
    val_id: session.valId,
    amount: (Number(session.fields.total_amount) * BDT_RATE).toFixed(2),
    currency: "BDT",
    bank_tran_id: session.bankTranId,
    card_type: session.cardType,
    currency_type: session.fields.currency,
    currency_amount: session.currencyAmount,
    risk_level: "0",
    risk_title: "Safe",
});

const fakeSslCommerz = {
    createSession: vi.fn(async (fields: Record<string, string>): Promise<ISslSession> => {
        const tranId = fields.tran_id as string;
        const sessionKey = key();

        sessions.set(tranId, {
            tranId,
            fields,
            status: "PROCESSING",
            valId: "",
            bankTranId: "",
            cardType: "",
            currencyAmount: fields.total_amount as string,
            refundRef: null,
        });

        const gateway = (gw: string, name: string) => ({
            name,
            type: "mobilebanking",
            gw,
            redirectGatewayURL: `https://sandbox.sslcommerz.test/gwprocess/v4/bankgw/indexhtmlOTP.php?SESSIONKEY=${sessionKey}&cardname=${gw}`,
        });

        return {
            status: "SUCCESS",
            failedreason: "",
            sessionkey: sessionKey,
            GatewayPageURL: `https://sandbox.sslcommerz.test/EasyCheckOut/${sessionKey}`,
            desc: withGateways ? [gateway("bkash", "bKash"), gateway("nagad", "Nagad")] : [],
        };
    }),
    findTransactions: vi.fn(async (tranId: string) => {
        const session = sessions.get(tranId);

        return session ? [transactionOf(session)] : [];
    }),
    validate: vi.fn(async (valId: string): Promise<ISslTransaction> => {
        const session = [...sessions.values()].find((item) => item.valId === valId);

        if (!session) {
            return {
                status: "INVALID_TRANSACTION",
                tran_id: "",
                val_id: valId,
                amount: "",
                currency: "BDT",
                bank_tran_id: "",
                card_type: "",
            };
        }

        const transaction = transactionOf(session);

        if (session.status === "VALID") {
            session.status = "VALIDATED";
        }

        return transaction;
    }),
    refund: vi.fn(async (request: ISslRefundRequest) => {
        if (refundError) {
            return { status: "failed" as const, refund_ref_id: "", errorReason: refundError };
        }

        const session = [...sessions.values()].find((item) => item.bankTranId === request.bankTransactionId);

        if (!session) {
            return { status: "failed" as const, refund_ref_id: "", errorReason: "Invalid Request" };
        }

        if (session.refundRef) {
            return { status: "processing" as const, refund_ref_id: session.refundRef, errorReason: "Already refund initiated!" };
        }

        session.refundRef = randomBytes(6).toString("hex");

        return { status: "success" as const, refund_ref_id: session.refundRef, errorReason: "" };
    }),
};

export const isSslCommerzReady = () => ready;

const getSslCommerz = (): ISslCommerz => {
    if (!ready) {
        throw new AppError(StatusCodes.SERVICE_UNAVAILABLE, "bKash and Nagad are not available", "SSLCOMMERZ_STORE_ID is missing");
    }

    return fakeSslCommerz;
};

export default getSslCommerz;

export const sslTest = {
    client: fakeSslCommerz,
    session: (tranId: string) => findSession(tranId),
    pay: (tranId: string, cardType = "BKASH-BKash") => {
        const session = findSession(tranId);

        session.status = "VALID";
        session.valId = `${key()}V`;
        session.bankTranId = `${key()}B`;
        session.cardType = cardType;

        return { ...session };
    },
    fail: (tranId: string) => {
        findSession(tranId).status = "FAILED";
    },
    cancel: (tranId: string) => {
        findSession(tranId).status = "CANCELLED";
    },
    changeAmount: (tranId: string, currencyAmount: string) => {
        findSession(tranId).currencyAmount = currencyAmount;
    },
    setReady: (value: boolean) => {
        ready = value;
    },
    showGateways: (value: boolean) => {
        withGateways = value;
    },
    failRefunds: (reason: string | null = "Refund is not possible now") => {
        refundError = reason;
    },
    reset: () => {
        sessions.clear();
        ready = true;
        withGateways = true;
        refundError = null;
        fakeSslCommerz.createSession.mockClear();
        fakeSslCommerz.findTransactions.mockClear();
        fakeSslCommerz.validate.mockClear();
        fakeSslCommerz.refund.mockClear();
    },
};
