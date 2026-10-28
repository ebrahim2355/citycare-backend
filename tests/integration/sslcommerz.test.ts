import { beforeAll, describe, expect, it } from "vitest";
import { PaymentStatus } from "../../src/generated/prisma/client";
import { mailTest } from "../fakes/mailer";
import { BDT_RATE, sslTest } from "../fakes/sslcommerz";
import { stripeTest } from "../fakes/stripe";
import { prisma, resetDatabase } from "../helpers/db";
import { createCity, type ITestUser, submitComplaint } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

interface IComplaint {
    id: string;
    trackingCode: string;
}

interface IPayment {
    id: string;
    transactionId: string;
    provider: string;
    method: string;
    status: string;
}

const FRONTEND = "http://localhost:3000";
const CRON = { Authorization: "Bearer citycare-test-cron-secret" };
const MINUTE = 60 * 1000;

let admin: ITestUser;
let c1: ITestUser;
let c2: ITestUser;
let bulkId: string;

const requestPickup = (citizen: ITestUser = c1): Promise<IComplaint> =>
    submitComplaint(citizen, bulkId, {
        title: "Broken cupboard pickup",
        description: "A broken cupboard needs to be collected from the gate.",
        address: "House 9, Road 3, Dhanmondi",
        area: "Dhanmondi",
    });

const startCheckout = async (complaintId: string, method: string, citizen: ITestUser = c1) => {
    const res = await http(citizen.token).post("/payments/initiate", { complaintId, method, clientUrl: FRONTEND });

    expect(res.status, JSON.stringify(res.body)).toBe(201);

    return res.body.data as { payment: IPayment; checkoutUrl: string; reused: boolean };
};

const gatewayReturn = (outcome: "success" | "fail" | "cancel", tranId: string, client: string | null = FRONTEND) =>
    http()
        .raw.upload(`/payments/sslcommerz/${outcome}${client ? `?client=${encodeURIComponent(client)}` : ""}`)
        .type("form")
        .send({ tran_id: tranId, status: outcome === "success" ? "VALID" : outcome.toUpperCase(), val_id: "forged-by-the-browser" });

const sendIpn = (tranId: string, status: string) =>
    http().upload("/payments/sslcommerz/ipn").type("form").send({ tran_id: tranId, status, val_id: "from-the-form" });

const paymentRow = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });

const complaintState = async (id: string) => {
    const complaint = await prisma.complaint.findUniqueOrThrow({ where: { id } });

    return `${complaint.status}/${complaint.paymentStatus}`;
};

const auditCount = (action: string, entityId: string) => prisma.auditLog.count({ where: { action, entityId } });

beforeAll(async () => {
    await resetDatabase();

    const city = await createCity();

    admin = city.admin;
    c1 = city.citizen;
    c2 = city.citizen2;
    bulkId = city.bulk.id;
});

describe("payment methods", () => {
    it("lists card, bKash and Nagad with their provider", async () => {
        const res = await http().get("/payments/methods");

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({
            currency: "usd",
            methods: [
                { method: "CARD", label: "Card", provider: "STRIPE", available: true, testMode: true },
                { method: "BKASH", label: "bKash", provider: "SSLCOMMERZ", available: true, testMode: true },
                { method: "NAGAD", label: "Nagad", provider: "SSLCOMMERZ", available: true, testMode: true },
            ],
        });
    });

    it("marks bKash and Nagad as not available and refuses them when the store is not set", async () => {
        const pickup = await requestPickup();

        sslTest.setReady(false);

        try {
            const methods = await http().get("/payments/methods");
            const res = await http(c1.token).post("/payments/initiate", { complaintId: pickup.id, method: "BKASH" });

            expect(methods.body.data.methods.map((item: { available: boolean }) => item.available)).toEqual([true, false, false]);
            expect(res.status).toBe(503);
            expect(await prisma.payment.count({ where: { complaintId: pickup.id } })).toBe(0);
        } finally {
            sslTest.setReady(true);
        }
    });

    it("refuses an unknown method", async () => {
        const pickup = await requestPickup();
        const res = await http(c1.token).post("/payments/initiate", { complaintId: pickup.id, method: "PAYPAL" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "method")).toBe(true);
    });
});

describe("bKash checkout", () => {
    let pickup: IComplaint;
    let payment: IPayment;

    it("opens an SSLCommerz session that goes straight to the bKash gateway", async () => {
        pickup = await requestPickup();

        const result = await startCheckout(pickup.id, "BKASH");
        const fields = sslTest.client.createSession.mock.calls.at(-1)?.[0];

        payment = result.payment;
        expect(result.reused).toBe(false);
        expect(payment).toMatchObject({ provider: "SSLCOMMERZ", method: "BKASH", status: "PENDING", currency: "usd" });
        expect(payment.transactionId).toMatch(/^CC[0-9A-F]{24}$/);
        expect(result.checkoutUrl).toContain("cardname=bkash");
        expect(fields).toMatchObject({
            tran_id: payment.transactionId,
            total_amount: "15.00",
            currency: "USD",
            multi_card_name: "bkash",
            cus_email: c1.email,
            product_profile: "non-physical-goods",
            success_url: `http://localhost:5000/api/v1/payments/sslcommerz/success?client=${encodeURIComponent(FRONTEND)}`,
            fail_url: `http://localhost:5000/api/v1/payments/sslcommerz/fail?client=${encodeURIComponent(FRONTEND)}`,
            cancel_url: `http://localhost:5000/api/v1/payments/sslcommerz/cancel?client=${encodeURIComponent(FRONTEND)}`,
            ipn_url: "http://localhost:5000/api/v1/payments/sslcommerz/ipn",
            value_a: pickup.id,
        });
        expect(await auditCount("PAYMENT_INITIATED", payment.id)).toBe(1);
    });

    it("does not settle on a success post that SSLCommerz does not confirm", async () => {
        const res = await gatewayReturn("success", payment.transactionId);

        expect(res.status).toBe(303);
        expect(res.headers.location).toBe(`${FRONTEND}/payment/success?tran_id=${payment.transactionId}`);
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.PENDING);
        expect(await complaintState(pickup.id)).toBe("PENDING_PAYMENT/UNPAID");
        expect(sslTest.client.validate).not.toHaveBeenCalled();

        const verify = await http(c1.token).post("/payments/verify", { tranId: payment.transactionId });

        expect(verify.body.data).toMatchObject({ paid: false, payment: { status: "PENDING" } });
    });

    it("settles after SSLCommerz validates the payment and sends the citizen to the frontend", async () => {
        sslTest.pay(payment.transactionId);

        const res = await gatewayReturn("success", payment.transactionId);
        const row = await paymentRow(payment.id);

        expect(res.status).toBe(303);
        expect(res.headers.location).toBe(`${FRONTEND}/payment/success?tran_id=${payment.transactionId}`);
        expect(row.status).toBe(PaymentStatus.COMPLETED);
        expect(row.validationId).toMatch(/V$/);
        expect(row.bankTransactionId).toMatch(/B$/);
        expect(Number(row.chargedAmount)).toBe(15 * BDT_RATE);
        expect(row.chargedCurrency).toBe("bdt");
        expect(await complaintState(pickup.id)).toBe("SUBMITTED/PAID");
        expect(mailTest.sentTo(c1.email).filter((email) => email.subject === `Payment received (${pickup.trackingCode})`)).toHaveLength(1);
    });

    it("settles once when the return, the IPN and verify arrive again", async () => {
        const [again, ipn, verify] = await Promise.all([
            gatewayReturn("success", payment.transactionId),
            sendIpn(payment.transactionId, "VALID"),
            http(c1.token).post("/payments/verify", { tranId: payment.transactionId }),
        ]);

        expect([again.status, ipn.status, verify.status]).toEqual([303, 200, 200]);
        expect(ipn.body.data).toEqual({ received: true, paid: true });
        expect(verify.body.data).toMatchObject({ paid: true, payment: { status: "COMPLETED", method: "BKASH" } });
        expect(await auditCount("PAYMENT_COMPLETED", payment.id)).toBe(1);
        expect(await prisma.complaintUpdate.count({ where: { complaintId: pickup.id, note: { startsWith: "Service fee paid" } } })).toBe(1);
    });

    it("shows the payment to its owner only", async () => {
        const verify = await http(c2.token).post("/payments/verify", { tranId: payment.transactionId });
        const mine = await http(c1.token).get("/payments?method=BKASH");
        const card = await http(c1.token).get("/payments?method=CARD");

        expect(verify.status).toBe(403);
        expect(mine.body.data.map((item: IPayment) => item.id)).toContain(payment.id);
        expect(card.body.data.map((item: IPayment) => item.id)).not.toContain(payment.id);
    });

    it("refunds through SSLCommerz when the admin rejects the request", async () => {
        const res = await http(admin.token).patch(`/complaints/${pickup.id}/status`, {
            status: "REJECTED",
            note: "Cupboards are not part of the bulk pickup.",
        });
        const row = await paymentRow(payment.id);
        const refund = sslTest.client.refund.mock.calls.at(-1)?.[0];

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "REJECTED", paymentStatus: "REFUNDED" });
        expect(res.body.data.payments[0]).toMatchObject({ status: "REFUNDED", provider: "SSLCOMMERZ", method: "BKASH" });
        expect(refund).toEqual({
            bankTransactionId: row.bankTransactionId,
            refundTransactionId: `R${payment.transactionId}`,
            amount: (15 * BDT_RATE).toFixed(2),
            remarks: expect.any(String),
            referenceId: payment.id,
        });
        expect(row.status).toBe(PaymentStatus.REFUNDED);
        expect(row.refundId).toMatch(/^[0-9a-f]{12}$/);
        expect(
            mailTest.sentTo(c1.email).find((email) => email.subject === `Your complaint was rejected (${pickup.trackingCode})`)?.html
        ).toContain("refunded to your bKash account");
    });
});

describe("Nagad checkout that fails or is cancelled", () => {
    it("marks the payment failed and sends the citizen to the cancel page", async () => {
        const pickup = await requestPickup();
        const { payment, checkoutUrl } = await startCheckout(pickup.id, "NAGAD");

        expect(checkoutUrl).toContain("cardname=nagad");

        sslTest.fail(payment.transactionId);

        const res = await gatewayReturn("fail", payment.transactionId);
        const cancelPage = await http().get(`/payments/cancel?tran_id=${payment.transactionId}`);

        expect(res.status).toBe(303);
        expect(res.headers.location).toBe(`${FRONTEND}/payment/cancel?tran_id=${payment.transactionId}`);
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.FAILED);
        expect(cancelPage.body.data).toMatchObject({ paid: false, payment: { status: "FAILED", method: "NAGAD" } });
        expect(await complaintState(pickup.id)).toBe("PENDING_PAYMENT/UNPAID");
        expect(await auditCount("PAYMENT_FAILED", payment.id)).toBe(1);
    });

    it("marks the payment cancelled when the citizen leaves the gateway", async () => {
        const pickup = await requestPickup();
        const { payment } = await startCheckout(pickup.id, "NAGAD");

        sslTest.cancel(payment.transactionId);

        const res = await gatewayReturn("cancel", payment.transactionId);

        expect(res.headers.location).toBe(`${FRONTEND}/payment/cancel?tran_id=${payment.transactionId}`);
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.CANCELLED);
    });

    it("answers with JSON when there is no allowed client to go back to", async () => {
        const pickup = await requestPickup();
        const { payment } = await startCheckout(pickup.id, "NAGAD");
        const outside = await gatewayReturn("cancel", payment.transactionId, "https://evil.example.com");
        const unknown = await http()
            .upload("/payments/sslcommerz/success")
            .type("form")
            .send({ tran_id: `CC${"0".repeat(24)}` });
        const malformed = await http().upload("/payments/sslcommerz/success").type("form").send({ tran_id: "cs_test_abc" });

        expect(outside.status).toBe(200);
        expect(outside.body.data).toMatchObject({ paid: false, payment: { status: "CANCELLED" } });
        expect(unknown.status).toBe(404);
        expect(malformed.status).toBe(400);
    });

    it("goes to the frontend success page when SSLCommerz cannot be reached, so the page can check again", async () => {
        const pickup = await requestPickup();
        const { payment } = await startCheckout(pickup.id, "NAGAD");

        sslTest.client.findTransactions.mockRejectedValueOnce(new Error("network down"));

        const res = await gatewayReturn("success", payment.transactionId);

        expect(res.headers.location).toBe(`${FRONTEND}/payment/success?tran_id=${payment.transactionId}`);
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.PENDING);
    });
});

describe("callbacks without a frontend", () => {
    it("the success callback needs a confirmed payment and the cancel callback closes it", async () => {
        const pickup = await requestPickup();
        const { payment } = await startCheckout(pickup.id, "BKASH");
        const early = await http().get(`/payments/success?tran_id=${payment.transactionId}`);
        const both = await http().get(`/payments/success?tran_id=${payment.transactionId}&session_id=cs_test_abc`);
        const none = await http().get("/payments/success");

        expect(early.status).toBe(409);
        expect(both.status).toBe(400);
        expect(none.status).toBe(400);

        const cancelled = await http().get(`/payments/cancel?tran_id=${payment.transactionId}`);

        expect(cancelled.body.data).toMatchObject({ paid: false, payment: { status: "CANCELLED" } });

        sslTest.pay(payment.transactionId);

        const late = await http().get(`/payments/success?tran_id=${payment.transactionId}`);

        expect(late.status).toBe(200);
        expect(late.body.data).toMatchObject({ status: "COMPLETED", complaint: { status: "SUBMITTED" } });
    });

    it("verify needs exactly one of sessionId and tranId", async () => {
        const neither = await http(c1.token).post("/payments/verify", {});
        const both = await http(c1.token).post("/payments/verify", { sessionId: "cs_test_abc", tranId: `CC${"A".repeat(24)}` });

        expect(neither.status).toBe(400);
        expect(both.status).toBe(400);
        expect(hasFieldError(neither, "sessionId")).toBe(true);
    });
});

describe("IPN", () => {
    it("completes a payment when the citizen never comes back", async () => {
        const pickup = await requestPickup();
        const { payment } = await startCheckout(pickup.id, "BKASH");

        sslTest.pay(payment.transactionId);

        const res = await sendIpn(payment.transactionId, "VALID");

        expect(res.body.data).toEqual({ received: true, paid: true });
        expect(await complaintState(pickup.id)).toBe("SUBMITTED/PAID");
    });

    it("closes a failed payment and ignores transactions it does not know", async () => {
        const pickup = await requestPickup();
        const { payment } = await startCheckout(pickup.id, "NAGAD");

        sslTest.fail(payment.transactionId);

        const failed = await sendIpn(payment.transactionId, "FAILED");
        const unknown = await sendIpn(`CC${"B".repeat(24)}`, "VALID");

        expect(failed.body.data).toEqual({ received: true, paid: false });
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.FAILED);
        expect(unknown.body.data).toEqual({ received: true, paid: false });
    });

    it("does not accept a payment for another amount", async () => {
        const pickup = await requestPickup();
        const { payment } = await startCheckout(pickup.id, "BKASH");

        sslTest.pay(payment.transactionId);
        sslTest.changeAmount(payment.transactionId, "1.00");

        const res = await sendIpn(payment.transactionId, "VALID");

        expect(res.body.data).toEqual({ received: true, paid: false });
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.PENDING);
        expect(await complaintState(pickup.id)).toBe("PENDING_PAYMENT/UNPAID");
    });
});

describe("switching between methods", () => {
    it("falls back to the SSLCommerz page when the store has no direct gateway", async () => {
        const pickup = await requestPickup();

        sslTest.showGateways(false);

        try {
            const { checkoutUrl } = await startCheckout(pickup.id, "NAGAD");

            expect(checkoutUrl).toMatch(/^https:\/\/sandbox\.sslcommerz\.test\/EasyCheckOut\//);
        } finally {
            sslTest.showGateways(true);
        }
    });

    it("closes an open card checkout when the citizen picks bKash", async () => {
        const pickup = await requestPickup();
        const card = await startCheckout(pickup.id, "CARD");
        const bkash = await startCheckout(pickup.id, "BKASH");

        expect(card.payment.provider).toBe("STRIPE");
        expect(stripeTest.session(card.payment.transactionId).status).toBe("expired");
        expect((await paymentRow(card.payment.id)).status).toBe(PaymentStatus.CANCELLED);
        expect(bkash.payment).toMatchObject({ method: "BKASH", status: "PENDING" });
        expect(await auditCount("PAYMENT_FAILED", card.payment.id)).toBe(1);
    });

    it("starts a new session for every bKash or Nagad attempt and cancels the unpaid one", async () => {
        const pickup = await requestPickup();
        const first = await startCheckout(pickup.id, "BKASH");
        const second = await startCheckout(pickup.id, "NAGAD");

        expect(second.payment.id).not.toBe(first.payment.id);
        expect((await paymentRow(first.payment.id)).status).toBe(PaymentStatus.CANCELLED);
        expect(await prisma.payment.count({ where: { complaintId: pickup.id, status: PaymentStatus.PENDING } })).toBe(1);
    });

    it("settles a pending payment that was paid instead of opening a new one", async () => {
        const pickup = await requestPickup();
        const { payment } = await startCheckout(pickup.id, "BKASH");

        sslTest.pay(payment.transactionId);

        const res = await http(c1.token).post("/payments/initiate", { complaintId: pickup.id, method: "NAGAD" });

        expect(res.status).toBe(409);
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.COMPLETED);
        expect(await complaintState(pickup.id)).toBe("SUBMITTED/PAID");
    });

    it("refunds a second payment for a request that is already paid and keeps the request paid", async () => {
        const pickup = await requestPickup();
        const first = await startCheckout(pickup.id, "BKASH");
        const second = await startCheckout(pickup.id, "NAGAD");

        sslTest.pay(second.payment.transactionId, "NAGAD-Nagad");
        await gatewayReturn("success", second.payment.transactionId);

        sslTest.pay(first.payment.transactionId);

        const late = await sendIpn(first.payment.transactionId, "VALID");
        const firstRow = await paymentRow(first.payment.id);
        const notification = await prisma.notification.findFirst({
            where: { userId: c1.id, complaintId: pickup.id, type: "PAYMENT_REFUNDED" },
        });

        expect(late.body.data.paid).toBe(true);
        expect(firstRow.status).toBe(PaymentStatus.REFUNDED);
        expect((await paymentRow(second.payment.id)).status).toBe(PaymentStatus.COMPLETED);
        expect(await complaintState(pickup.id)).toBe("SUBMITTED/PAID");
        expect(notification?.title).toBe("Your extra payment was refunded");
        expect(await prisma.complaintUpdate.count({ where: { complaintId: pickup.id, note: { startsWith: "Service fee paid" } } })).toBe(1);
    });

    it("lets the admin retry a refused refund of an extra payment while the request stays open", async () => {
        const pickup = await requestPickup();
        const first = await startCheckout(pickup.id, "BKASH");
        const second = await startCheckout(pickup.id, "NAGAD");

        sslTest.pay(second.payment.transactionId);
        await sendIpn(second.payment.transactionId, "VALID");
        sslTest.pay(first.payment.transactionId);
        sslTest.failRefunds("Merchant balance is too low");

        try {
            await sendIpn(first.payment.transactionId, "VALID");

            expect((await paymentRow(first.payment.id)).status).toBe(PaymentStatus.COMPLETED);

            const refused = await http(admin.token).post(`/payments/${first.payment.id}/refund`);

            expect(refused.status).toBe(502);
            expect(refused.body.errors[0].message).toContain("Merchant balance is too low");
        } finally {
            sslTest.failRefunds(null);
        }

        const retried = await http(admin.token).post(`/payments/${first.payment.id}/refund`);
        const stillOpen = await http(admin.token).post(`/payments/${second.payment.id}/refund`);

        expect(retried.status).toBe(200);
        expect(retried.body.data).toMatchObject({ status: "REFUNDED", complaint: { status: "SUBMITTED", paymentStatus: "PAID" } });
        expect(stillOpen.status).toBe(409);
    });
});

describe("cancelling the request", () => {
    it("closes the open bKash checkout without calling Stripe", async () => {
        const pickup = await requestPickup();
        const { payment } = await startCheckout(pickup.id, "BKASH");

        stripeTest.client.checkout.sessions.expire.mockClear();

        const res = await http(c1.token).post(`/complaints/${pickup.id}/cancel`, { reason: "A neighbour took the cupboard" });

        expect(res.status).toBe(200);
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.CANCELLED);
        expect(stripeTest.client.checkout.sessions.expire).not.toHaveBeenCalled();
    });
});

describe("daily payment check", () => {
    it("needs the cron secret", async () => {
        expect((await http().get("/jobs/payment-check")).status).toBe(401);
        expect((await http(admin.token).get("/jobs/payment-check")).status).toBe(401);
    });

    it("settles old payments that were paid and closes the ones that were not", async () => {
        const paidPickup = await requestPickup(c2);
        const openPickup = await requestPickup(c2);
        const freshPickup = await requestPickup(c2);
        const paid = await startCheckout(paidPickup.id, "BKASH", c2);
        const open = await startCheckout(openPickup.id, "NAGAD", c2);
        const fresh = await startCheckout(freshPickup.id, "NAGAD", c2);
        const twoHoursAgo = new Date(Date.now() - 120 * MINUTE);

        await prisma.payment.updateMany({ where: { id: { in: [paid.payment.id, open.payment.id] } }, data: { createdAt: twoHoursAgo } });
        sslTest.pay(paid.payment.transactionId);

        const res = await http(undefined, CRON).get("/jobs/payment-check");

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ checked: 2, settled: 1, closed: 1, failed: 0 });
        expect(await complaintState(paidPickup.id)).toBe("SUBMITTED/PAID");
        expect((await paymentRow(open.payment.id)).status).toBe(PaymentStatus.CANCELLED);
        expect((await paymentRow(fresh.payment.id)).status).toBe(PaymentStatus.PENDING);
    });
});

describe("audit trail", () => {
    it("records every bKash and Nagad step exactly once", async () => {
        const where = { provider: "SSLCOMMERZ" as const };
        const ids = (await prisma.payment.findMany({ where, select: { id: true } })).map((payment) => payment.id);
        const count = (action: string) => prisma.auditLog.count({ where: { action, entityId: { in: ids } } });

        expect(await count("PAYMENT_INITIATED")).toBe(ids.length);
        expect(await count("PAYMENT_COMPLETED")).toBe(await prisma.payment.count({ where: { ...where, paidAt: { not: null } } }));
        expect(await count("PAYMENT_REFUNDED")).toBe(await prisma.payment.count({ where: { ...where, status: PaymentStatus.REFUNDED } }));
    });
});
