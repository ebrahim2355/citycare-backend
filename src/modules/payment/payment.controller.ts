import { StatusCodes } from "http-status-codes";
import logger from "../../lib/logger";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { PaymentCheckout } from "./payment.checkout";
import { PaymentRefund } from "./payment.refund";
import { PaymentService } from "./payment.service";
import { PaymentSettlement } from "./payment.settlement";
import { PaymentSslCommerz, type TReturnOutcome } from "./payment.sslcommerz";
import { allowedClientOrigin } from "./payment.utils";
import type { TCallbackQuery, TVerifyPaymentPayload } from "./payment.validation";

const getMethods = catchAsync(async (_req, res) => {
    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Payment methods retrieved successfully",
        data: PaymentService.getMethods(),
    });
});

const initiatePayment = catchAsync(async (req, res) => {
    const result = await PaymentCheckout.initiatePayment(currentUser(req), req.body, getRequestContext(req));

    sendResponse(res, {
        statusCode: result.reused ? StatusCodes.OK : StatusCodes.CREATED,
        message: result.reused
            ? "A checkout is already open for this request. Use the same link."
            : "Checkout session created. Open checkoutUrl to pay.",
        data: result,
    });
});

const handleWebhook = catchAsync(async (req, res) => {
    const signature = req.headers["stripe-signature"];
    const result = await PaymentSettlement.handleWebhook(req.rawBody, Array.isArray(signature) ? signature[0] : signature);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Webhook received",
        data: result,
    });
});

const verifyPayment = catchAsync(async (req, res) => {
    const body = req.body as TVerifyPaymentPayload;
    const result = body.tranId
        ? await PaymentSslCommerz.verifyPayment(currentUser(req), body.tranId)
        : await PaymentSettlement.verifyPayment(currentUser(req), body.sessionId as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: result.paid ? "Payment verified successfully" : "Payment is not completed yet",
        data: result,
    });
});

const handleSuccess = catchAsync(async (_req, res) => {
    const query = res.locals.query as TCallbackQuery;
    const result = query.tran_id
        ? await PaymentSslCommerz.handleSuccessCallback(query.tran_id)
        : await PaymentSettlement.handleSuccessCallback(query.session_id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Payment successful. Your service request is submitted.",
        data: result,
    });
});

const handleCancel = catchAsync(async (_req, res) => {
    const query = res.locals.query as TCallbackQuery;
    const result = query.tran_id
        ? await PaymentSslCommerz.handleCancelCallback(query.tran_id)
        : await PaymentSettlement.handleCancelCallback(query.session_id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: result.paid ? "This checkout was already paid" : "Payment cancelled. Nothing was charged and you can try again.",
        data: result,
    });
});

const sslReturnMessages: Record<TReturnOutcome, string> = {
    success: "Payment is not completed yet",
    fail: "Payment failed. Nothing was charged and you can try again.",
    cancel: "Payment cancelled. Nothing was charged and you can try again.",
};

const handleSslReturn = (outcome: TReturnOutcome) =>
    catchAsync(async (req, res) => {
        const tranId = req.body.tran_id as string;
        const clientOrigin = allowedClientOrigin(res.locals.query?.client);

        if (clientOrigin) {
            const paid = await PaymentSslCommerz.handleReturn(tranId, outcome).then(
                (result) => result.paid,
                (error) => {
                    logger.warn({ err: error, tranId, outcome }, "SSLCommerz return could not be checked");

                    return false;
                }
            );
            const page = paid || outcome === "success" ? "success" : "cancel";

            res.redirect(StatusCodes.SEE_OTHER, `${clientOrigin}/payment/${page}?tran_id=${encodeURIComponent(tranId)}`);
            return;
        }

        const result = await PaymentSslCommerz.handleReturn(tranId, outcome);

        sendResponse(res, {
            statusCode: StatusCodes.OK,
            message: result.paid ? "Payment successful. Your service request is submitted." : sslReturnMessages[outcome],
            data: result,
        });
    });

const handleSslIpn = catchAsync(async (req, res) => {
    const result = await PaymentSslCommerz.handleIpn(req.body.tran_id, req.body.status);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "IPN received",
        data: result,
    });
});

const refundPayment = catchAsync(async (req, res) => {
    const result = await PaymentRefund.refundByAdmin(currentUser(req), req.params.id as string, getRequestContext(req));

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Payment refunded successfully",
        data: result,
    });
});

const getPayments = catchAsync(async (req, res) => {
    const result = await PaymentService.getPayments(currentUser(req), res.locals.query);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Payments retrieved successfully",
        meta: result.meta,
        data: result.data,
    });
});

const getPaymentById = catchAsync(async (req, res) => {
    const result = await PaymentService.getPaymentById(currentUser(req), req.params.id as string);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Payment retrieved successfully",
        data: result,
    });
});

export const PaymentController = {
    getMethods,
    getPayments,
    getPaymentById,
    initiatePayment,
    handleWebhook,
    verifyPayment,
    handleSuccess,
    handleCancel,
    sslSuccess: handleSslReturn("success"),
    sslFail: handleSslReturn("fail"),
    sslCancel: handleSslReturn("cancel"),
    handleSslIpn,
    refundPayment,
};
