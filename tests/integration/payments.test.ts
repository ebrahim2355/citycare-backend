import { beforeAll, describe, expect, it } from "vitest";
import { ComplaintStatus, PaymentStatus } from "../../src/generated/prisma/client";
import { mailTest } from "../fakes/mailer";
import { stripeTest } from "../fakes/stripe";
import { prisma, resetDatabase } from "../helpers/db";
import { createCity, type ITestUser, MISSING_ID, submitComplaint } from "../helpers/factories";
import { hasFieldError, http } from "../helpers/http";

interface IComplaint {
    id: string;
    trackingCode: string;
}

interface IPayment {
    id: string;
    transactionId: string;
    status: string;
    amount: string;
    currency: string;
}

interface ISignedEvent {
    payload: string;
    signature: string;
}

type TRefundCall = [{ payment_intent?: string }, { idempotencyKey?: string }?];

const HOUR = 60 * 60 * 1000;

let admin: ITestUser;
let staff: ITestUser;
let c1: ITestUser;
let c2: ITestUser;
let bulkId: string;
let first: IComplaint;
let freeOne: IComplaint;
let firstPayment: IPayment;
let paidEvent: ISignedEvent;
let second: IComplaint;
let secondPayment: IPayment;
let thirdPayment: IPayment;
let fourthPayment: IPayment;
let paidRequest: IComplaint;
let paidPayment: IPayment;
let paidIntentId: string | null;
let failingPayment: IPayment;
let failingIntentId: string | null;

const requestPickup = (citizen: ITestUser): Promise<IComplaint> =>
    submitComplaint(citizen, bulkId, {
        title: "Old sofa and fridge pickup",
        description: "Two large items need to be collected.",
        address: "House 4, Road 2, Mirpur",
        area: "Mirpur",
    });

const startCheckout = async (citizen: ITestUser, complaintId: string, clientUrl?: string): Promise<IPayment> => {
    const res = await http(citizen.token).post("/payments/initiate", clientUrl ? { complaintId, clientUrl } : { complaintId });

    expect(res.status, JSON.stringify(res.body)).toBe(201);

    return res.body.data.payment;
};

const sendWebhook = (event: ISignedEvent) =>
    http(undefined, { "Content-Type": "application/json", "stripe-signature": event.signature })
        .upload("/payments/webhook")
        .send(event.payload);

const successCallback = (sessionId: string) => http().get(`/payments/success?session_id=${sessionId}`);

const payAndReturn = async (payment: IPayment) => {
    const session = stripeTest.pay(payment.transactionId);
    const res = await successCallback(payment.transactionId);

    expect(res.status, JSON.stringify(res.body)).toBe(200);

    return { session, res };
};

const paymentRow = (id: string) => prisma.payment.findUniqueOrThrow({ where: { id } });

const complaintState = async (id: string) => {
    const complaint = await prisma.complaint.findUniqueOrThrow({ where: { id } });

    return `${complaint.status}/${complaint.paymentStatus}`;
};

const auditCount = (action: string, entityId: string) => prisma.auditLog.count({ where: { action, entityId } });

const emailsAbout = (user: ITestUser, subject: string) => mailTest.sentTo(user.email).filter((email) => email.subject === subject);

const refundKeys = (paymentIntentId: string | null) =>
    (stripeTest.client.refunds.create.mock.calls as unknown as TRefundCall[])
        .filter(([params]) => params.payment_intent === paymentIntentId)
        .map(([, options]) => options?.idempotencyKey);

beforeAll(async () => {
    await resetDatabase();

    const city = await createCity();

    admin = city.admin;
    staff = city.wasteStaff;
    c1 = city.citizen;
    c2 = city.citizen2;
    bulkId = city.bulk.id;
    first = await requestPickup(c1);
    freeOne = await submitComplaint(c1, city.garbage.id, {
        title: "Garbage not collected",
        description: "The bins on our road were not emptied this week.",
    });
});

describe("initiate", () => {
    it("is only for the citizen who owns an unpaid service request", async () => {
        const body = { complaintId: first.id };

        expect((await http().post("/payments/initiate", body)).status).toBe(401);
        expect((await http(staff.token).post("/payments/initiate", body)).status).toBe(403);
        expect((await http(admin.token).post("/payments/initiate", body)).status).toBe(403);
        expect((await http(c2.token).post("/payments/initiate", body)).status).toBe(403);
        expect((await http(c1.token).post("/payments/initiate", { complaintId: MISSING_ID })).status).toBe(404);
        expect((await http(c1.token).post("/payments/initiate", { complaintId: freeOne.id })).status).toBe(409);

        const withoutId = await http(c1.token).post("/payments/initiate", {});

        expect(withoutId.status).toBe(400);
        expect(hasFieldError(withoutId, "complaintId")).toBe(true);
    });

    it("refuses a client URL outside the allowed list before calling Stripe", async () => {
        const res = await http(c1.token).post("/payments/initiate", { complaintId: first.id, clientUrl: "https://evil.example.com" });

        expect(res.status).toBe(400);
        expect(hasFieldError(res, "clientUrl")).toBe(true);
        expect(stripeTest.client.checkout.sessions.create).not.toHaveBeenCalled();
    });

    it("opens a Stripe checkout that returns to the allowed frontend", async () => {
        const res = await http(c1.token).post("/payments/initiate", { complaintId: first.id, clientUrl: "http://localhost:3000/" });

        expect(res.status).toBe(201);
        firstPayment = res.body.data.payment;
        expect(firstPayment).toMatchObject({ status: "PENDING", currency: "usd" });
        expect(Number(firstPayment.amount)).toBe(15);

        const session = stripeTest.session(firstPayment.transactionId);

        expect(res.body.data).toMatchObject({ reused: false, checkoutUrl: session.url });
        expect(session.success_url).toBe("http://localhost:3000/payment/success?session_id={CHECKOUT_SESSION_ID}");
        expect(session.cancel_url).toBe("http://localhost:3000/payment/cancel?session_id={CHECKOUT_SESSION_ID}");
        expect(session).toMatchObject({ amount_total: 1500, currency: "usd", metadata: { complaintId: first.id, citizenId: c1.id } });
        expect(stripeTest.client.checkout.sessions.create).toHaveBeenCalledWith(
            expect.objectContaining({ mode: "payment", customer_email: c1.email, client_reference_id: first.id })
        );
    });

    it("reuses the open checkout when the citizen starts again", async () => {
        const res = await http(c1.token).post("/payments/initiate", { complaintId: first.id });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ reused: true, payment: { id: firstPayment.id } });
        expect(stripeTest.client.checkout.sessions.create).not.toHaveBeenCalled();
        expect(await prisma.payment.count({ where: { complaintId: first.id } })).toBe(1);
    });

    it("keeps one pending payment and one open session when five checkouts start at once", async () => {
        const raceRequest = await requestPickup(c2);
        const race = await Promise.all(
            Array.from({ length: 5 }, () => http(c2.token).post("/payments/initiate", { complaintId: raceRequest.id }))
        );
        const statuses = race.map((res) => res.status);

        expect(
            statuses.every((status) => [200, 201, 409].includes(status)),
            String(statuses)
        ).toBe(true);
        expect(statuses.filter((status) => status === 201)).toHaveLength(1);

        const pending = await prisma.payment.findMany({ where: { complaintId: raceRequest.id, status: PaymentStatus.PENDING } });
        const openSessions = stripeTest
            .sessions()
            .filter((session) => session.metadata.complaintId === raceRequest.id && session.status === "open");

        expect(pending).toHaveLength(1);
        expect(openSessions.map((session) => session.id)).toEqual([pending[0]?.transactionId]);
    });
});

describe("before paying", () => {
    it("verify checks the session id and its owner", async () => {
        const bad = await http(c1.token).post("/payments/verify", { sessionId: "nope" });

        expect(bad.status).toBe(400);
        expect(hasFieldError(bad, "sessionId")).toBe(true);
        expect((await http(c2.token).post("/payments/verify", { sessionId: firstPayment.transactionId })).status).toBe(403);

        const res = await http(c1.token).post("/payments/verify", { sessionId: firstPayment.transactionId });

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ paid: false, payment: { id: firstPayment.id, status: "PENDING" } });
    });

    it("the success callback needs a known session that is paid", async () => {
        expect((await successCallback(firstPayment.transactionId)).status).toBe(409);
        expect((await http().get("/payments/success")).status).toBe(400);
        expect((await successCallback("cs_test_doesnotexist123")).status).toBe(404);
        expect((await paymentRow(firstPayment.id)).status).toBe(PaymentStatus.PENDING);
    });
});

describe("webhook", () => {
    it("refuses events without a valid Stripe signature", async () => {
        const forged = {
            ...stripeTest.session(firstPayment.transactionId),
            status: "complete",
            payment_status: "paid",
            payment_intent: "pi_test_forged",
        };
        const badSignature = http(undefined, { "stripe-signature": "t=1,v1=bad" });

        expect((await http().post("/payments/webhook", { type: "checkout.session.completed" })).status).toBe(400);
        expect((await badSignature.post("/payments/webhook", { type: "checkout.session.completed" })).status).toBe(400);
        expect((await sendWebhook(stripeTest.signedEvent("checkout.session.completed", forged, "whsec_someone_else"))).status).toBe(400);
        expect((await paymentRow(firstPayment.id)).status).toBe(PaymentStatus.PENDING);
        expect(await complaintState(first.id)).toBe("PENDING_PAYMENT/UNPAID");
    });

    it("settles the payment from a signed checkout.session.completed event", async () => {
        paidEvent = stripeTest.signedEvent("checkout.session.completed", stripeTest.pay(firstPayment.transactionId));

        const res = await sendWebhook(paidEvent);

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ received: true, type: "checkout.session.completed" });
        expect((await paymentRow(firstPayment.id)).status).toBe(PaymentStatus.COMPLETED);
        expect(await complaintState(first.id)).toBe("SUBMITTED/PAID");
    });

    it("submits the request with a due date, a timeline entry and a receipt email", async () => {
        const res = await http(c1.token).get(`/complaints/${first.id}`);
        const complaint = res.body.data;

        expect(complaint.submittedAt).toBeTruthy();
        expect(new Date(complaint.dueAt).getTime() - new Date(complaint.submittedAt).getTime()).toBe(72 * HOUR);
        expect(complaint.updates.at(-1).note).toContain("Service fee paid");
        expect(complaint.payments[0].status).toBe("COMPLETED");
        expect(emailsAbout(c1, `Payment received (${first.trackingCode})`)).toHaveLength(1);
    });

    it("ignores the same event when Stripe sends it again", async () => {
        expect((await sendWebhook(paidEvent)).status).toBe(200);
        expect(await prisma.complaintUpdate.count({ where: { complaintId: first.id } })).toBe(2);
        expect(await auditCount("PAYMENT_COMPLETED", firstPayment.id)).toBe(1);
        expect(emailsAbout(c1, `Payment received (${first.trackingCode})`)).toHaveLength(1);
    });

    it("accepts events it does not handle", async () => {
        const res = await sendWebhook(stripeTest.signedEvent("customer.created", { id: "cus_test_1", object: "customer" }));

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ received: true, type: "customer.created" });
    });

    it("refuses a new checkout for a paid request", async () => {
        expect((await http(c1.token).post("/payments/initiate", { complaintId: first.id })).status).toBe(409);
    });
});

describe("cancel callback and expiry", () => {
    it("returns to the API when no client URL is given", async () => {
        second = await requestPickup(c1);
        secondPayment = await startCheckout(c1, second.id);

        const session = stripeTest.session(secondPayment.transactionId);

        expect(session.success_url).toBe("http://localhost:5000/api/v1/payments/success?session_id={CHECKOUT_SESSION_ID}");
        expect(session.cancel_url).toBe("http://localhost:5000/api/v1/payments/cancel?session_id={CHECKOUT_SESSION_ID}");
    });

    it("cancels the payment and expires the session from the cancel callback", async () => {
        const res = await http().get(`/payments/cancel?session_id=${secondPayment.transactionId}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ paid: false, payment: { id: secondPayment.id, status: "CANCELLED" } });
        expect(stripeTest.session(secondPayment.transactionId).status).toBe("expired");
        expect(await complaintState(second.id)).toBe("PENDING_PAYMENT/UNPAID");
    });

    it("starts a fresh checkout after a cancel, also for the second allowed frontend", async () => {
        thirdPayment = await startCheckout(c1, second.id, "http://localhost:3001");

        expect(thirdPayment.id).not.toBe(secondPayment.id);
        expect(stripeTest.session(thirdPayment.transactionId).success_url).toBe(
            "http://localhost:3001/payment/success?session_id={CHECKOUT_SESSION_ID}"
        );
    });

    it("cancels the payment when Stripe reports the session as expired", async () => {
        const expired = stripeTest.expireOutsideApi(thirdPayment.transactionId);
        const res = await sendWebhook(stripeTest.signedEvent("checkout.session.expired", expired));

        expect(res.status).toBe(200);
        expect((await paymentRow(thirdPayment.id)).status).toBe(PaymentStatus.CANCELLED);
    });

    it("closes the open checkout when the citizen cancels the request", async () => {
        fourthPayment = await startCheckout(c1, second.id);

        const res = await http(c1.token).post(`/complaints/${second.id}/cancel`, {});

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "CANCELLED", paymentStatus: "UNPAID" });
        expect((await paymentRow(fourthPayment.id)).status).toBe(PaymentStatus.CANCELLED);
        expect(stripeTest.session(fourthPayment.transactionId).status).toBe("expired");
    });

    it("refuses a checkout for a cancelled request", async () => {
        expect((await http(c1.token).post("/payments/initiate", { complaintId: second.id })).status).toBe(409);
    });
});

describe("payment history", () => {
    it("shows a citizen only their own payments", async () => {
        const all = await http(c1.token).get("/payments");

        expect(all.status).toBe(200);
        expect(all.body.meta.total).toBe(4);
        expect(all.body.data.every((item: { citizen: { id: string } }) => item.citizen.id === c1.id)).toBe(true);

        const completed = await http(c1.token).get("/payments?status=COMPLETED");

        expect(completed.body.meta.total).toBe(1);
        expect(completed.body.data[0].id).toBe(firstPayment.id);

        const secondPage = await http(c1.token).get("/payments?limit=2&page=2");

        expect(secondPage.body.data).toHaveLength(2);
        expect(secondPage.body.meta.totalPages).toBe(2);
        expect((await http(c2.token).get(`/payments?citizenId=${c1.id}`)).body.meta.total).toBe(1);
    });

    it("shows an admin every payment", async () => {
        expect((await http(admin.token).get("/payments")).body.meta.total).toBe(5);
        expect((await http(admin.token).get(`/payments?citizenId=${c2.id}`)).body.meta.total).toBe(1);
        expect((await http(staff.token).get("/payments")).status).toBe(403);
        expect((await http(admin.token).get("/payments?status=PAID")).status).toBe(400);
    });

    it("shows one payment to its owner and to the admin", async () => {
        const res = await http(c1.token).get(`/payments/${firstPayment.id}`);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "COMPLETED", complaint: { trackingCode: first.trackingCode } });
        expect((await http(c2.token).get(`/payments/${firstPayment.id}`)).status).toBe(403);
        expect((await http(admin.token).get(`/payments/${firstPayment.id}`)).status).toBe(200);
        expect((await http(admin.token).get(`/payments/${MISSING_ID}`)).status).toBe(404);
    });

    it("keeps the fee of a request that is still open", async () => {
        expect((await http(c1.token).post(`/payments/${firstPayment.id}/refund`)).status).toBe(403);
        expect((await http(admin.token).post(`/payments/${firstPayment.id}/refund`)).status).toBe(409);
        expect((await http(admin.token).delete(`/complaints/${first.id}`)).status).toBe(409);
        expect((await paymentRow(firstPayment.id)).status).toBe(PaymentStatus.COMPLETED);
        expect(stripeTest.client.refunds.create).not.toHaveBeenCalled();
    });
});

describe("paid checkout, then reject and refund", () => {
    it("settles once when the callback, the webhook and verify arrive together", async () => {
        paidRequest = await requestPickup(c1);
        paidPayment = await startCheckout(c1, paidRequest.id);

        const session = stripeTest.pay(paidPayment.transactionId);

        paidIntentId = session.payment_intent;

        const [callback, webhook, verify] = await Promise.all([
            successCallback(paidPayment.transactionId),
            sendWebhook(stripeTest.signedEvent("checkout.session.completed", session)),
            http(c1.token).post("/payments/verify", { sessionId: paidPayment.transactionId }),
        ]);

        expect([callback.status, webhook.status, verify.status]).toEqual([200, 200, 200]);
        expect(callback.body.data).toMatchObject({ status: "COMPLETED", complaint: { status: "SUBMITTED", paymentStatus: "PAID" } });
        expect(verify.body.data).toMatchObject({ paid: true, payment: { status: "COMPLETED" } });

        const row = await paymentRow(paidPayment.id);

        expect(row.status).toBe(PaymentStatus.COMPLETED);
        expect(row.paymentIntentId).toMatch(/^pi_/);
        expect(row.paymentIntentId).toBe(paidIntentId);
        expect(await complaintState(paidRequest.id)).toBe("SUBMITTED/PAID");
        expect(await auditCount("PAYMENT_COMPLETED", paidPayment.id)).toBe(1);
        expect(
            await prisma.complaintUpdate.count({ where: { complaintId: paidRequest.id, note: { startsWith: "Service fee paid" } } })
        ).toBe(1);
        expect(emailsAbout(c1, `Payment received (${paidRequest.trackingCode})`)).toHaveLength(1);
    });

    it("stays the same when the citizen returns or verifies again", async () => {
        const callback = await successCallback(paidPayment.transactionId);
        const verify = await http(c1.token).post("/payments/verify", { sessionId: paidPayment.transactionId });

        expect(callback.status).toBe(200);
        expect(verify.status).toBe(200);
        expect(verify.body.data).toMatchObject({ paid: true, payment: { status: "COMPLETED" } });
        expect(await auditCount("PAYMENT_COMPLETED", paidPayment.id)).toBe(1);
    });

    it("refunds the fee when the admin rejects the request", async () => {
        const res = await http(admin.token).patch(`/complaints/${paidRequest.id}/status`, {
            status: "REJECTED",
            note: "This item is not covered by the pickup service.",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain("refunded");
        expect(res.body.data).toMatchObject({ status: "REJECTED", paymentStatus: "REFUNDED" });
        expect(res.body.data.payments[0].status).toBe("REFUNDED");
        expect(res.body.data.updates.at(-1).note).toContain("Service fee refunded");
        expect(refundKeys(paidIntentId)).toEqual([`citycare_refund_${paidPayment.id}`]);

        const row = await paymentRow(paidPayment.id);

        expect(row.status).toBe(PaymentStatus.REFUNDED);
        expect(row.refundId).toMatch(/^re_/);
        expect(row.refundedAt).not.toBeNull();
        expect(emailsAbout(c1, `Your complaint was rejected (${paidRequest.trackingCode})`)[0]?.html).toContain("refunded to your card");
    });

    it("does not refund twice", async () => {
        const res = await http(admin.token).post(`/payments/${paidPayment.id}/refund`);

        expect(res.status).toBe(200);
        expect(res.body.data.status).toBe("REFUNDED");
        expect(await auditCount("PAYMENT_REFUNDED", paidPayment.id)).toBe(1);
        expect(stripeTest.client.refunds.create).not.toHaveBeenCalled();
    });
});

describe("paid checkout, then the citizen cancels", () => {
    it("refunds the fee", async () => {
        const pickup = await requestPickup(c1);
        const payment = await startCheckout(c1, pickup.id);
        const { res: callback } = await payAndReturn(payment);

        expect(callback.body.data.status).toBe("COMPLETED");

        const res = await http(c1.token).post(`/complaints/${pickup.id}/cancel`, { reason: "I do not need the pickup any more" });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain("refunded");
        expect(res.body.data).toMatchObject({ status: "CANCELLED", paymentStatus: "REFUNDED" });
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.REFUNDED);
    });
});

describe("payment that arrives after the request was closed", () => {
    it("is refunded automatically", async () => {
        const late = await requestPickup(c1);
        const payment = await startCheckout(c1, late.id);

        await prisma.complaint.update({ where: { id: late.id }, data: { status: ComplaintStatus.CANCELLED } });

        const { session, res } = await payAndReturn(payment);

        expect(res.body.data.status).toBe("REFUNDED");
        expect((await paymentRow(payment.id)).status).toBe(PaymentStatus.REFUNDED);
        expect(await complaintState(late.id)).toBe("CANCELLED/REFUNDED");
        expect(refundKeys(session.payment_intent)).toEqual([`citycare_refund_${payment.id}`]);
        expect(emailsAbout(c1, `Payment received (${late.trackingCode})`)).toHaveLength(0);
    });
});

describe("refund that Stripe refuses", () => {
    it("keeps the payment when the refund fails on reject", async () => {
        const failing = await requestPickup(c1);

        failingPayment = await startCheckout(c1, failing.id);
        failingIntentId = (await payAndReturn(failingPayment)).session.payment_intent;
        stripeTest.failRefunds();

        const res = await http(admin.token).patch(`/complaints/${failing.id}/status`, {
            status: "REJECTED",
            note: "The address is outside the pickup area.",
        });

        expect(res.status).toBe(200);
        expect(res.body.message).toContain("The refund could not be completed now");
        expect(res.body.data).toMatchObject({ status: "REJECTED", paymentStatus: "PAID" });
        expect((await paymentRow(failingPayment.id)).status).toBe(PaymentStatus.COMPLETED);
        expect(await auditCount("PAYMENT_REFUNDED", failingPayment.id)).toBe(0);
        expect(refundKeys(failingIntentId)).toEqual([`citycare_refund_${failingPayment.id}`]);
    });

    it("lets the admin retry the refund with the same idempotency key", async () => {
        const failed = await http(admin.token).post(`/payments/${failingPayment.id}/refund`);

        expect(failed.status).toBe(502);
        expect((await paymentRow(failingPayment.id)).status).toBe(PaymentStatus.COMPLETED);

        stripeTest.failRefunds(null);

        const res = await http(admin.token).post(`/payments/${failingPayment.id}/refund`);

        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({ status: "REFUNDED", complaint: { status: "REJECTED", paymentStatus: "REFUNDED" } });
        expect(refundKeys(failingIntentId)).toEqual(Array(2).fill(`citycare_refund_${failingPayment.id}`));
        expect(await auditCount("PAYMENT_REFUNDED", failingPayment.id)).toBe(1);
    });
});

describe("audit trail", () => {
    it("records every payment step exactly once", async () => {
        const expected = {
            PAYMENT_INITIATED: await prisma.payment.count(),
            PAYMENT_COMPLETED: await prisma.payment.count({ where: { paidAt: { not: null } } }),
            PAYMENT_FAILED: await prisma.payment.count({ where: { status: { in: [PaymentStatus.CANCELLED, PaymentStatus.FAILED] } } }),
            PAYMENT_REFUNDED: await prisma.payment.count({ where: { status: PaymentStatus.REFUNDED } }),
        };

        for (const [action, total] of Object.entries(expected)) {
            expect(total, action).toBeGreaterThan(0);
            expect(await prisma.auditLog.count({ where: { entityType: "PAYMENT", action } }), action).toBe(total);
        }
    });
});
