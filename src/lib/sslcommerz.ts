import { StatusCodes } from "http-status-codes";
import config from "../config";
import AppError from "../errors/AppError";

export interface ISslGateway {
    name: string;
    type: string;
    gw: string;
    redirectGatewayURL?: string;
}

export interface ISslSession {
    status: "SUCCESS" | "FAILED";
    failedreason: string;
    sessionkey: string;
    GatewayPageURL: string;
    desc?: ISslGateway[];
}

export interface ISslTransaction {
    status: string;
    tran_id: string;
    val_id: string;
    amount: string;
    currency: string;
    bank_tran_id: string;
    card_type: string;
    card_issuer?: string;
    currency_type?: string;
    currency_amount?: string;
    risk_level?: string;
    risk_title?: string;
}

export interface ISslRefund {
    status: "success" | "failed" | "processing";
    refund_ref_id: string;
    errorReason: string;
}

export interface ISslRefundRequest {
    bankTransactionId: string;
    refundTransactionId: string;
    amount: string;
    remarks: string;
    referenceId: string;
}

export interface ISslCommerz {
    createSession: (fields: Record<string, string>) => Promise<ISslSession>;
    findTransactions: (tranId: string) => Promise<ISslTransaction[]>;
    validate: (valId: string) => Promise<ISslTransaction>;
    refund: (request: ISslRefundRequest) => Promise<ISslRefund>;
}

const TIMEOUT_MS = 15000;

const providerError = (detail: string) => new AppError(StatusCodes.BAD_GATEWAY, "Payment provider error", detail);

const call = async <T>(path: string, init?: RequestInit): Promise<T & { APIConnect?: string }> => {
    let response: Response;

    try {
        response = await fetch(`${config.sslcommerz.baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch {
        throw providerError("SSLCommerz could not be reached. Please try again.");
    }

    if (!response.ok) {
        throw providerError(`SSLCommerz answered with HTTP ${response.status}`);
    }

    const body = (await response.json().catch(() => null)) as (T & { APIConnect?: string }) | null;

    if (!body) {
        throw providerError("SSLCommerz sent an answer that is not JSON");
    }

    if (body.APIConnect && body.APIConnect !== "DONE") {
        throw providerError(`SSLCommerz refused the request (${body.APIConnect})`);
    }

    return body;
};

const credentials = () => ({
    store_id: config.sslcommerz.storeId,
    store_passwd: config.sslcommerz.storePassword,
});

const query = (fields: Record<string, string>) => new URLSearchParams({ ...fields, ...credentials(), format: "json" }).toString();

const client: ISslCommerz = {
    createSession: async (fields) => {
        const session = await call<ISslSession>("/gwprocess/v4/api.php", {
            method: "POST",
            body: new URLSearchParams({ ...fields, ...credentials() }),
        });

        if (session.status !== "SUCCESS" || !session.GatewayPageURL) {
            throw providerError(session.failedreason || "SSLCommerz did not open a checkout session");
        }

        return session;
    },
    findTransactions: async (tranId) => {
        const result = await call<{ no_of_trans_found?: number; element?: ISslTransaction[] }>(
            `/validator/api/merchantTransIDvalidationAPI.php?${query({ tran_id: tranId })}`
        );

        return result.no_of_trans_found ? (result.element ?? []) : [];
    },
    validate: (valId) => call<ISslTransaction>(`/validator/api/validationserverAPI.php?${query({ val_id: valId, v: "1" })}`),
    refund: (request) =>
        call<ISslRefund>(
            `/validator/api/merchantTransIDvalidationAPI.php?${query({
                bank_tran_id: request.bankTransactionId,
                refund_trans_id: request.refundTransactionId,
                refund_amount: request.amount,
                refund_remarks: request.remarks,
                refe_id: request.referenceId,
                v: "1",
            })}`
        ),
};

export const isSslCommerzReady = () => Boolean(config.sslcommerz.storeId && config.sslcommerz.storePassword);

const getSslCommerz = (): ISslCommerz => {
    if (!isSslCommerzReady()) {
        throw new AppError(
            StatusCodes.SERVICE_UNAVAILABLE,
            "bKash and Nagad are not available",
            "SSLCOMMERZ_STORE_ID or SSLCOMMERZ_STORE_PASSWORD is missing on the server"
        );
    }

    return client;
};

export default getSslCommerz;
