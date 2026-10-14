import nodemailer, { type Transporter } from "nodemailer";
import config from "../config";

interface IEmail {
    to: string;
    subject: string;
    html: string;
}

let transporter: Transporter | null | undefined;

const timeouts = { connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 10000 };

const createTransporter = (): Transporter | null => {
    const { user, password, smtpHost, smtpPort } = config.email;

    if (smtpHost) {
        return nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort,
            secure: smtpPort === 465,
            ...(user && password ? { auth: { user, pass: password } } : {}),
            ...timeouts,
        });
    }

    if (user && password) {
        return nodemailer.createTransport({ service: "gmail", auth: { user, pass: password }, ...timeouts });
    }

    return null;
};

const getTransporter = () => {
    if (transporter === undefined) {
        transporter = createTransporter();
    }

    return transporter;
};

export const isEmailEnabled = () => getTransporter() !== null;

export const sendEmail = async (email: IEmail): Promise<boolean> => {
    const mailer = getTransporter();

    if (!mailer) {
        return false;
    }

    try {
        await mailer.sendMail({ from: config.email.from, to: email.to, subject: email.subject, html: email.html });

        return true;
    } catch (error) {
        console.error(`Email "${email.subject}" to ${email.to} failed: ${error instanceof Error ? error.message : "unknown error"}`);

        return false;
    }
};
