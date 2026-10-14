const escapeHtml = (value: string) => {
    return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
};

const layout = (title: string, lines: string[], highlight?: { label: string; value: string }) => {
    const paragraphs = lines.map((line) => `<p style="margin:0 0 12px;color:#334155;font-size:15px;line-height:1.6">${line}</p>`).join("");
    const box = highlight
        ? `<div style="margin:16px 0;padding:14px 16px;background:#f1f5f9;border-radius:8px"><span style="color:#64748b;font-size:13px">${escapeHtml(highlight.label)}</span><br /><strong style="font-size:18px;color:#0f172a;letter-spacing:0.5px">${escapeHtml(highlight.value)}</strong></div>`
        : "";

    return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 4px;color:#0f766e">CityCare</h2>
<h3 style="margin:0 0 16px;color:#0f172a">${escapeHtml(title)}</h3>
${paragraphs}${box}
<p style="margin:24px 0 0;color:#94a3b8;font-size:12px">This is an automatic email from the CityCare complaint and service request platform.</p>
</div>`;
};

interface IComplaintInfo {
    trackingCode: string;
    title: string;
}

export const EmailTemplates = {
    welcome: (name: string) => ({
        subject: "Welcome to CityCare",
        html: layout("Your account is ready", [
            `Hello ${escapeHtml(name)},`,
            "Thank you for joining CityCare. You can now report problems in your area, request city services and follow every step until it is resolved.",
        ]),
    }),

    staffAccount: (name: string, role: string, department: string | null) => ({
        subject: "Your CityCare account was created",
        html: layout("An account was created for you", [
            `Hello ${escapeHtml(name)},`,
            `The city admin created a ${role.toLowerCase()} account for you${department ? ` in the ${escapeHtml(department)} department` : ""}.`,
            "Ask the admin for your first password, or use the forgot password option with this email address to set your own password.",
        ]),
    }),

    passwordReset: (name: string, token: string, minutes: number, link: string | null) => ({
        subject: "Reset your CityCare password",
        html: layout(
            "Password reset request",
            [
                `Hello ${escapeHtml(name)},`,
                link
                    ? `We received a request to reset your password. <a href="${link}" style="color:#0f766e">Click here to choose a new password</a>.`
                    : "We received a request to reset your password. Use the reset token below with the reset password request.",
                `The token works for ${minutes} minutes and only once. If you did not ask for this, you can ignore this email.`,
            ],
            { label: "Reset token", value: token }
        ),
    }),

    complaintReceived: (name: string, complaint: IComplaintInfo, needsPayment: boolean, fee: string) => ({
        subject: `${needsPayment ? "Payment needed" : "We received your complaint"} (${complaint.trackingCode})`,
        html: layout(
            needsPayment ? "Your service request is waiting for payment" : "Your complaint was submitted",
            [
                `Hello ${escapeHtml(name)},`,
                `We received "${escapeHtml(complaint.title)}".`,
                needsPayment
                    ? `Please pay the service fee of ${escapeHtml(fee)} to submit the request to the department.`
                    : "The responsible department will review it and assign a staff member.",
                "You can follow the progress any time with your tracking code.",
            ],
            { label: "Tracking code", value: complaint.trackingCode }
        ),
    }),

    paymentReceived: (name: string, complaint: IComplaintInfo, amount: string) => ({
        subject: `Payment received (${complaint.trackingCode})`,
        html: layout(
            "Your payment was successful",
            [
                `Hello ${escapeHtml(name)},`,
                `We received your payment of ${escapeHtml(amount)} for "${escapeHtml(complaint.title)}". The request is now submitted to the department.`,
            ],
            { label: "Tracking code", value: complaint.trackingCode }
        ),
    }),

    complaintAssigned: (name: string, complaint: IComplaintInfo, staffName: string) => ({
        subject: `A staff member is working on your complaint (${complaint.trackingCode})`,
        html: layout(
            "Your complaint was assigned",
            [`Hello ${escapeHtml(name)},`, `"${escapeHtml(complaint.title)}" was assigned to ${escapeHtml(staffName)}.`],
            { label: "Tracking code", value: complaint.trackingCode }
        ),
    }),

    newAssignment: (staffName: string, complaint: IComplaintInfo, area: string, priority: string) => ({
        subject: `New complaint assigned to you (${complaint.trackingCode})`,
        html: layout(
            "You have a new assignment",
            [
                `Hello ${escapeHtml(staffName)},`,
                `"${escapeHtml(complaint.title)}" in ${escapeHtml(area)} was assigned to you. Priority: ${escapeHtml(priority)}.`,
            ],
            { label: "Tracking code", value: complaint.trackingCode }
        ),
    }),

    complaintResolved: (name: string, complaint: IComplaintInfo, note: string | null) => ({
        subject: `Your complaint was resolved (${complaint.trackingCode})`,
        html: layout(
            "Your complaint was resolved",
            [
                `Hello ${escapeHtml(name)},`,
                `"${escapeHtml(complaint.title)}" was marked as resolved.`,
                ...(note ? [`Note from the staff: ${escapeHtml(note)}`] : []),
                "Please give your feedback. If the problem is still there, you can reopen the complaint within a few days.",
            ],
            { label: "Tracking code", value: complaint.trackingCode }
        ),
    }),

    complaintRejected: (name: string, complaint: IComplaintInfo, reason: string | null, refunded: boolean) => ({
        subject: `Your complaint was rejected (${complaint.trackingCode})`,
        html: layout(
            "Your complaint was rejected",
            [
                `Hello ${escapeHtml(name)},`,
                `"${escapeHtml(complaint.title)}" was rejected by the city admin.`,
                ...(reason ? [`Reason: ${escapeHtml(reason)}`] : []),
                ...(refunded ? ["The service fee you paid was refunded to your card."] : []),
            ],
            { label: "Tracking code", value: complaint.trackingCode }
        ),
    }),
};
