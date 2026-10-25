import nodemailer, { type Transporter } from "nodemailer";
import config from "../config";
import logger from "./logger";

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

const isSkippedAddress = (address: string) => {
    const domain = address.split("@")[1]?.toLowerCase() ?? "";

    return config.email.skipDomains.includes(domain);
};

export const sendEmail = async (email: IEmail): Promise<boolean> => {
    const mailer = getTransporter();

    if (!mailer || isSkippedAddress(email.to)) {
        return false;
    }

    try {
        await mailer.sendMail({ from: config.email.from, to: email.to, subject: email.subject, html: email.html });

        return true;
    } catch (error) {
        logger.error({ err: error, subject: email.subject }, "Email could not be sent");

        return false;
    }
};
