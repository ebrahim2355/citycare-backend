import { StatusCodes } from "http-status-codes";
import { currentUser } from "../../middlewares/auth";
import catchAsync from "../../utils/catchAsync";
import { getRequestContext } from "../../utils/requestContext";
import sendResponse from "../../utils/sendResponse";
import { PaymentCheckout } from "./payment.checkout";

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

export const PaymentController = {
    initiatePayment,
};
