import { StatusCodes } from "http-status-codes";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { ComplaintEscalation } from "../complaint/complaint.escalation";
import { PaymentSslCommerz } from "../payment/payment.sslcommerz";

const runSlaCheck = catchAsync(async (_req, res) => {
    const result = await ComplaintEscalation.runSlaCheck();

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: `${result.escalated} overdue complaint${result.escalated === 1 ? " was" : "s were"} escalated`,
        data: result,
    });
});

const runPaymentCheck = catchAsync(async (_req, res) => {
    const result = await PaymentSslCommerz.reconcileStalePayments();

    sendResponse(res, {
        statusCode: StatusCodes.OK,
        message: `${result.checked} open bKash or Nagad payment${result.checked === 1 ? " was" : "s were"} checked`,
        data: result,
    });
});

export const JobsController = {
    runSlaCheck,
    runPaymentCheck,
};
