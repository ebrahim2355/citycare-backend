import config from "../../config";
import { sendEmail } from "../../lib/mailer";
import { EmailTemplates } from "./notification.templates";

interface IPerson {
    name: string;
    email: string;
}

interface IComplaintForEmail {
    trackingCode: string;
    title: string;
    status: string;
    priority: string;
    area: string;
    fee: unknown;
    paymentStatus: string;
    resolutionNote: string | null;
    rejectionReason: string | null;
    citizen: IPerson;
    assignedStaff: IPerson | null;
    payments?: { method: string; status: string }[];
}

const REFUND_TARGETS: Record<string, string> = {
    BKASH: "your bKash account",
    NAGAD: "your Nagad account",
};

const formatMoney = (amount: unknown) => `${config.stripe.currency.toUpperCase()} ${Number(amount).toFixed(2)}`;

const refundTarget = (complaint: IComplaintForEmail) => {
    if (complaint.paymentStatus !== "REFUNDED") {
        return null;
    }

    const method = complaint.payments?.find((payment) => payment.status === "REFUNDED")?.method ?? "CARD";

    return REFUND_TARGETS[method] ?? "your card";
};

const welcome = (user: IPerson) => {
    return sendEmail({ to: user.email, ...EmailTemplates.welcome(user.name) });
};

const staffAccount = (user: IPerson & { role: string; department: { name: string } | null }) => {
    return sendEmail({ to: user.email, ...EmailTemplates.staffAccount(user.name, user.role, user.department?.name ?? null) });
};

const passwordReset = (user: IPerson, token: string) => {
    const link = config.clientUrl ? `${config.clientUrl}/reset-password?token=${token}` : null;

    return sendEmail({ to: user.email, ...EmailTemplates.passwordReset(user.name, token, config.resetTokenMinutes, link) });
};

const complaintCreated = (complaint: IComplaintForEmail) => {
    const needsPayment = complaint.status === "PENDING_PAYMENT";

    return sendEmail({
        to: complaint.citizen.email,
        ...EmailTemplates.complaintReceived(complaint.citizen.name, complaint, needsPayment, formatMoney(complaint.fee)),
    });
};

const complaintAssigned = async (complaint: IComplaintForEmail) => {
    const staff = complaint.assignedStaff;

    if (!staff) {
        return;
    }

    await Promise.all([
        sendEmail({ to: complaint.citizen.email, ...EmailTemplates.complaintAssigned(complaint.citizen.name, complaint, staff.name) }),
        sendEmail({ to: staff.email, ...EmailTemplates.newAssignment(staff.name, complaint, complaint.area, complaint.priority) }),
    ]);
};

const complaintStatusChanged = async (complaint: IComplaintForEmail) => {
    if (complaint.status === "RESOLVED") {
        await sendEmail({
            to: complaint.citizen.email,
            ...EmailTemplates.complaintResolved(complaint.citizen.name, complaint, complaint.resolutionNote),
        });
    }

    if (complaint.status === "REJECTED") {
        await sendEmail({
            to: complaint.citizen.email,
            ...EmailTemplates.complaintRejected(complaint.citizen.name, complaint, complaint.rejectionReason, refundTarget(complaint)),
        });
    }
};

const paymentReceived = (payment: { amount: unknown; citizen: IPerson; complaint: { trackingCode: string; title: string } }) => {
    return sendEmail({
        to: payment.citizen.email,
        ...EmailTemplates.paymentReceived(payment.citizen.name, payment.complaint, formatMoney(payment.amount)),
    });
};

const contactReceived = (message: IPerson & { subject: string }) => {
    return sendEmail({ to: message.email, ...EmailTemplates.contactReceived(message.name, message.subject) });
};

const contactReply = (message: IPerson & { subject: string }, reply: string) => {
    return sendEmail({ to: message.email, ...EmailTemplates.contactReply(message.name, message.subject, reply) });
};

export const NotificationService = {
    welcome,
    staffAccount,
    passwordReset,
    complaintCreated,
    complaintAssigned,
    complaintStatusChanged,
    paymentReceived,
    contactReceived,
    contactReply,
};
