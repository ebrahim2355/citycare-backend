import request, { type Response, type Test } from "supertest";
import { expect } from "vitest";
import app from "../../src/app";

const BASE = "/api/v1";

const expectEnvelope = (res: Response, request: string) => {
    const label = `${request} -> ${res.status}`;
    const body = res.body as Record<string, unknown>;

    expect(typeof body?.success, `${label} has a success flag`).toBe("boolean");
    expect(typeof body.message, `${label} has a message`).toBe("string");
    expect(body.success, `${label} success flag matches the status`).toBe(res.status < 400);

    if (body.success) {
        expect(body, `${label} has data`).toHaveProperty("data");
    } else {
        expect(Array.isArray(body.errors), `${label} has errors`).toBe(true);
    }
};

export const http = (token?: string, headers: Record<string, string> = {}) => {
    const agent = request(app);

    const prepare = (test: Test, request: string, checked: boolean) => {
        if (token) {
            test.set("Authorization", `Bearer ${token}`);
        }

        for (const [name, value] of Object.entries(headers)) {
            test.set(name, value);
        }

        return checked ? test.expect((res) => expectEnvelope(res, request)) : test;
    };

    const client = (checked: boolean) => ({
        get: (path: string) => prepare(agent.get(`${BASE}${path}`), `GET ${path}`, checked),
        delete: (path: string) => prepare(agent.delete(`${BASE}${path}`), `DELETE ${path}`, checked),
        post: (path: string, body: object = {}) => prepare(agent.post(`${BASE}${path}`), `POST ${path}`, checked).send(body),
        patch: (path: string, body: object = {}) => prepare(agent.patch(`${BASE}${path}`), `PATCH ${path}`, checked).send(body),
        put: (path: string, body: object = {}) => prepare(agent.put(`${BASE}${path}`), `PUT ${path}`, checked).send(body),
        upload: (path: string) => prepare(agent.post(`${BASE}${path}`), `POST ${path}`, checked),
    });

    return { ...client(true), raw: client(false) };
};

export const fieldsOf = (res: Response) => ((res.body?.errors ?? []) as { field?: string }[]).map((item) => item.field);

export const hasFieldError = (res: Response, field: string) => fieldsOf(res).includes(field);

export { app };
