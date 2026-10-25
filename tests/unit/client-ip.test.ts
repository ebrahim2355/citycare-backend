import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { getClientIp, getClientUserAgent } from "../../src/utils/clientIp";
import { getRequestContext } from "../../src/utils/requestContext";

const fakeRequest = (headers: Record<string, string>, ip = "10.0.0.1") => {
    const lower = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));

    return { ip, get: (name: string) => lower[name.toLowerCase()] } as unknown as Request;
};

const internalKey = "citycare-test-internal-key";

describe("getClientIp", () => {
    it("uses the socket address by default", () => {
        expect(getClientIp(fakeRequest({}))).toBe("10.0.0.1");
    });

    it("trusts x-client-ip only together with the shared internal key", () => {
        expect(getClientIp(fakeRequest({ "x-client-ip": "203.0.113.7", "x-internal-key": internalKey }))).toBe("203.0.113.7");
        expect(getClientIp(fakeRequest({ "x-client-ip": "203.0.113.7" }))).toBe("10.0.0.1");
        expect(getClientIp(fakeRequest({ "x-client-ip": "203.0.113.7", "x-internal-key": "wrong-key" }))).toBe("10.0.0.1");
        expect(getClientIp(fakeRequest({ "x-client-ip": "203.0.113.7", "x-internal-key": `${internalKey}x` }))).toBe("10.0.0.1");
    });

    it("ignores a forwarded value that is not an ip address", () => {
        expect(getClientIp(fakeRequest({ "x-client-ip": "not-an-ip", "x-internal-key": internalKey }))).toBe("10.0.0.1");
    });

    it("accepts ipv6 addresses", () => {
        expect(getClientIp(fakeRequest({ "x-client-ip": "2001:db8::1", "x-internal-key": internalKey }))).toBe("2001:db8::1");
    });
});

describe("getRequestContext", () => {
    it("uses the forwarded user agent only from the trusted server and cuts it to 250 characters", () => {
        const long = "a".repeat(400);
        const trusted = fakeRequest({ "x-client-user-agent": long, "user-agent": "next-server", "x-internal-key": internalKey });
        const untrusted = fakeRequest({ "x-client-user-agent": "spoofed", "user-agent": "curl/8" });

        expect(getRequestContext(trusted).userAgent).toHaveLength(250);
        expect(getClientUserAgent(untrusted)).toBe("curl/8");
    });
});
