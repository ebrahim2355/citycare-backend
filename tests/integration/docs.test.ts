import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { resetDatabase } from "../helpers/db";
import { MISSING_ID } from "../helpers/factories";
import { http } from "../helpers/http";

interface IOperation {
    method: string;
    route: string;
    secured: boolean;
}

let operations: IOperation[];

const read = (file: string) => readFileSync(path.resolve(file), "utf8");

const fillParams = (route: string) => route.replace("{trackingCode}", "CC-261013-ABC234").replace(/\{\w+\}/g, MISSING_ID);

const send = (method: string, route: string) => {
    const client = http().raw;
    const url = fillParams(route);

    if (method === "GET") {
        return client.get(url);
    }

    if (method === "DELETE") {
        return client.delete(url);
    }

    return method === "PATCH" ? client.patch(url, {}) : client.post(url, {});
};

const routesIn = (source: string, mount: string) => {
    return [...source.matchAll(/router\.(get|post|patch|put|delete)\(\s*"([^"]*)"/g)].map(([, method = "", route = ""]) =>
        `${method.toUpperCase()} ${mount}${route === "/" ? "" : route}`.replace(/:(\w+)/g, "{$1}")
    );
};

const routesInCode = () => {
    const index = read("src/routes/index.ts");
    const mounts = new Map([...index.matchAll(/path: "([^"]+)", route: (\w+)/g)].map(([, mount = "", name = ""]) => [name, mount]));
    const files = readdirSync(path.resolve("src/modules"), { recursive: true, encoding: "utf8" }).filter((file) =>
        file.endsWith(".routes.ts")
    );

    return [
        ...routesIn(index, ""),
        ...files.flatMap((file) => {
            const source = read(path.join("src/modules", file));
            const name = source.match(/export const (\w+) = router/)?.[1] ?? file;

            return routesIn(source, mounts.get(name) ?? `/not-mounted/${name}`);
        }),
    ];
};

const readCollection = () => JSON.parse(read("postman/CityCare.postman_collection.json")) as { item: { name: string; item: unknown[] }[] };

beforeAll(resetDatabase);

describe("health", () => {
    it("reports the database and redis", async () => {
        const res = await http().get("/health");

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ database: "up", redis: process.env.REDIS_URL ? "up" : "disabled", uptime: expect.any(Number) });
    });

    it("answers the liveness probe", async () => {
        const res = await http().get("/health/live");

        expect(res.status).toBe(200);
        expect(res.body.data).toEqual({ uptime: expect.any(Number) });
    });
});

describe("swagger", () => {
    it("serves the docs page with a policy that allows the swagger assets", async () => {
        const res = await http().raw.get("/docs");

        expect(res.status).toBe(200);
        expect(res.headers["content-type"]).toContain("text/html");
        expect(res.text).toContain("swagger-ui");
        expect(res.headers["content-security-policy"]).toContain("https://unpkg.com");
    });

    it("serves the openapi document", async () => {
        const res = await http().raw.get("/docs/openapi.json");
        const paths = res.body.paths as Record<string, Record<string, { security?: unknown }>>;

        expect(res.status).toBe(200);
        expect(res.body.openapi).toMatch(/^3\./);
        operations = Object.entries(paths).flatMap(([route, methods]) =>
            Object.entries(methods).map(([method, operation]) => ({
                method: method.toUpperCase(),
                route,
                secured: Boolean(operation.security),
            }))
        );
        expect(operations.length).toBeGreaterThanOrEqual(20);
    });
});

describe("documented endpoints", () => {
    it("all exist and never answer with a server error", async () => {
        const broken: string[] = [];

        for (const { method, route } of operations) {
            const res = await send(method, route);

            if (res.body?.message === "Route not found" || (res.status >= 500 && res.status !== 503)) {
                broken.push(`${method} ${route} -> ${res.status}`);
            }
        }

        expect(broken).toEqual([]);
    });

    it("match the routes in the code one to one", () => {
        const documented = operations.map(({ method, route }) => `${method} ${route}`);

        expect(routesInCode().sort()).toEqual(documented.sort());
    });

    it("reject a request without a token when documented as protected", async () => {
        const open: string[] = [];

        for (const { method, route } of operations.filter((operation) => operation.secured)) {
            const res = await send(method, route);

            if (res.status !== 401) {
                open.push(`${method} ${route} -> ${res.status}`);
            }
        }

        expect(operations.some((operation) => operation.secured)).toBe(true);
        expect(open).toEqual([]);
    });
});

describe("postman collection", () => {
    it("starts with the demo flow and has a request for every endpoint", () => {
        const collection = readCollection();

        expect(collection.item[0]?.name).toMatch(/^Demo flow/);
        expect(collection.item.flatMap((folder) => folder.item).length).toBeGreaterThanOrEqual(operations.length + 20);
    });

    it("has no real secrets", () => {
        expect(read("postman/CityCare.postman_collection.json")).not.toMatch(/sk_test_|whsec_|eyJhbGci/);
    });
});
