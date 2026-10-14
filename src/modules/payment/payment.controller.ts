import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { PaymentCheckout } from "./payment.checkout";
import { PaymentRefund } from "./payment.refund";
import { PaymentService } from "./payment.service";
import { PaymentSettlement } from "./payment.settlement";

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
    const result = await PaymentSettlement.verifyPayment(currentUser(req), req.body.sessionId);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: result.paid ? "Payment verified successfully" : "Payment is not completed yet",
        data: result,
    });
});

const handleSuccess = catchAsync(async (_req, res) => {
    const result = await PaymentSettlement.handleSuccessCallback(res.locals.query.session_id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: "Payment successful. Your service request is submitted.",
        data: result,
    });
});

const handleCancel = catchAsync(async (_req, res) => {
    const result = await PaymentSettlement.handleCancelCallback(res.locals.query.session_id);

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: result.paid ? "This checkout was already paid" : "Payment cancelled. Nothing was charged and you can try again.",
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
    getPayments,
    getPaymentById,
    initiatePayment,
    handleWebhook,
    verifyPayment,
    handleSuccess,
    handleCancel,
    refundPayment,
};
