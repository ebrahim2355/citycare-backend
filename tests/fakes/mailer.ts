import { vi } from "vitest";

export interface ISentEmail {
    to: string;
    subject: string;
    html: string;
}

const outbox: ISentEmail[] = [];
let failing = false;

export const isEmailEnabled = () => true;

export const sendEmail = vi.fn(async (email: ISentEmail) => {
    if (failing) {
        return false;
    }

    outbox.push(email);

    return true;
});

export const mailTest = {
    outbox,
    sentTo: (address: string) => outbox.filter((email) => email.to === address),
    last: () => outbox.at(-1),
    fail: (value = true) => {
        failing = value;
    },
    reset: () => {
        outbox.length = 0;
        failing = false;
        sendEmail.mockClear();
    },
};
