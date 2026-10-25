import type { OAuth2Client, TokenPayload } from "google-auth-library";
import { vi } from "vitest";

const idTokens = new Map<string, TokenPayload>();
const codes = new Map<string, string>();

const fakeClient = {
    generateAuthUrl: vi.fn((options: { state?: string; scope?: string[] }) => {
        const url = new URL("https://accounts.google.test/o/oauth2/v2/auth");

        url.searchParams.set("client_id", "citycare-test.apps.googleusercontent.com");
        url.searchParams.set("scope", (options.scope ?? []).join(" "));
        url.searchParams.set("state", options.state ?? "");

        return url.toString();
    }),
    verifyIdToken: vi.fn(async ({ idToken }: { idToken: string }) => {
        const payload = idTokens.get(idToken);

        if (!payload) {
            throw new Error("Invalid token signature");
        }

        return { getPayload: () => payload };
    }),
    getToken: vi.fn(async (code: string) => {
        const idToken = codes.get(code);

        if (!idToken) {
            throw new Error("invalid_grant");
        }

        codes.delete(code);

        return { tokens: { id_token: idToken } };
    }),
};

const getGoogleClient = (_options: { needsSecret: boolean }) => fakeClient as unknown as OAuth2Client;

export default getGoogleClient;

export const googleTest = {
    client: fakeClient,
    profile: (idToken: string, payload: Partial<TokenPayload> & { sub: string; email: string }) => {
        idTokens.set(idToken, {
            iss: "https://accounts.google.com",
            aud: "citycare-test",
            iat: 0,
            exp: 0,
            email_verified: true,
            ...payload,
        });

        return idToken;
    },
    code: (code: string, idToken: string) => {
        codes.set(code, idToken);

        return code;
    },
    reset: () => {
        idTokens.clear();
        codes.clear();
        fakeClient.generateAuthUrl.mockClear();
        fakeClient.verifyIdToken.mockClear();
        fakeClient.getToken.mockClear();
    },
};
