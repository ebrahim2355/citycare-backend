import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { endpoints, type IEndpointDoc } from "../src/docs/swagger";

interface IRequestOptions {
    token?: string | null | undefined;
    body?: unknown;
    query?: (string | [string, string])[];
    test?: string[] | undefined;
    multipart?: boolean | undefined;
    description?: string;
}

interface IQueryItem {
    key: string;
    value: string;
    disabled?: boolean;
}

interface IPostmanItem {
    name: string;
    request: Record<string, unknown>;
    response: never[];
    event?: { listen: string; script: { type: string; exec: string[] } }[];
}

interface IFolder {
    name: string;
    description?: string;
    item: IPostmanItem[];
}

const BASE_URL = process.env.POSTMAN_BASE_URL || "https://citycare-backend.vercel.app/api/v1";
const OUTPUT = path.join(process.cwd(), "postman", "CityCare.postman_collection.json");

const TAG_ORDER = [
    "Auth",
    "Users",
    "Departments",
    "Categories",
    "Complaints",
    "Community",
    "Payments",
    "Notifications",
    "Stats",
    "Contact",
    "Admin",
    "System",
];

const tokenFor: Record<IEndpointDoc["access"], string | null> = {
    Public: null,
    Stripe: null,
    SSLCommerz: null,
    Scheduler: "cronSecret",
    Citizen: "citizenToken",
    Staff: "staffToken",
    Admin: "adminToken",
    "Any logged in user": "citizenToken",
    "Citizen or Admin": "citizenToken",
    "Staff or Admin": "staffToken",
};

const idVariables: [string, string][] = [
    ["/departments/", "departmentId"],
    ["/categories/", "categoryId"],
    ["/payments/", "paymentId"],
    ["/admin/users/", "userId"],
    ["/admin/messages/", "messageId"],
    ["/notifications/", "notificationId"],
];

const resolvePath = (apiPath: string) => {
    const idVariable = idVariables.find(([prefix]) => apiPath.startsWith(prefix))?.[1] ?? "complaintId";

    return apiPath
        .replace("{id}", `{{${idVariable}}}`)
        .replace("{trackingCode}", "{{trackingCode}}")
        .replace("{attachmentId}", "{{attachmentId}}")
        .replace("{commentId}", "{{commentId}}");
};

const fillBody = (body: Record<string, unknown> | undefined, apiPath: string) => {
    if (!body) {
        return undefined;
    }

    const filled: Record<string, unknown> = { ...body };
    const variables: [string, string][] = [
        ["categoryId", "{{categoryId}}"],
        ["departmentId", "{{departmentId}}"],
        ["staffId", "{{staffId}}"],
        ["refreshToken", "{{refreshToken}}"],
        ["sessionId", "{{sessionId}}"],
        ["tranId", "{{tranId}}"],
        ["tran_id", "{{tranId}}"],
    ];

    for (const [key, value] of variables) {
        if (key in filled) {
            filled[key] = value;
        }
    }

    if ("complaintId" in filled) {
        filled.complaintId = apiPath.startsWith("/payments") ? "{{serviceRequestId}}" : "{{complaintId}}";
    }

    return filled;
};

const request = (name: string, method: string, apiPath: string, options: IRequestOptions = {}): IPostmanItem => {
    const [pathOnly = "", inlineQuery] = apiPath.split("?");
    const queryItems: IQueryItem[] = [
        ...(inlineQuery ? inlineQuery.split("&").map((pair) => pair.split("=") as [string, string]) : []),
        ...(options.query ?? []),
    ].map((item) => (Array.isArray(item) ? { key: item[0], value: item[1] } : { key: item, value: "", disabled: true }));
    const activeQuery = queryItems.filter((item) => !item.disabled);
    const raw = `{{baseUrl}}${pathOnly}${activeQuery.length ? `?${activeQuery.map((item) => `${item.key}=${item.value}`).join("&")}` : ""}`;

    const requestBody = options.multipart
        ? {
              body: {
                  mode: "formdata",
                  formdata: [{ key: "images", type: "file", src: [], description: "Choose 1 or 2 JPG, PNG or WEBP images" }],
              },
          }
        : options.body
          ? { body: { mode: "raw", raw: JSON.stringify(options.body, null, 4), options: { raw: { language: "json" } } } }
          : {};

    return {
        name,
        request: {
            method: method.toUpperCase(),
            header: options.body ? [{ key: "Content-Type", value: "application/json" }] : [],
            url: {
                raw,
                host: ["{{baseUrl}}"],
                path: pathOnly.split("/").filter(Boolean),
                ...(queryItems.length ? { query: queryItems } : {}),
            },
            ...(options.description ? { description: options.description } : {}),
            auth: options.token
                ? { type: "bearer", bearer: [{ key: "token", value: `{{${options.token}}}`, type: "string" }] }
                : { type: "noauth" },
            ...requestBody,
        },
        response: [],
        ...(options.test ? { event: [{ listen: "test", script: { type: "text/javascript", exec: options.test } }] } : {}),
    };
};

const save = (lines: string[]) => [
    "const body = pm.response.json();",
    "if (body.success && body.data) {",
    ...lines.map((line) => `    ${line}`),
    "}",
];

const saveLogin = (tokenVariable: string, extra: string[] = []) =>
    save([`pm.collectionVariables.set('${tokenVariable}', body.data.accessToken);`, ...extra]);

const expectStatus = (status: number) => [`pm.test('status is ${status}', () => pm.response.to.have.status(${status}));`];

const savers: Record<string, string[]> = {
    "post /auth/login": saveLogin("citizenToken", ["pm.collectionVariables.set('refreshToken', body.data.refreshToken);"]),
    "post /auth/refresh-token": save([
        "pm.collectionVariables.set('citizenToken', body.data.accessToken);",
        "pm.collectionVariables.set('refreshToken', body.data.refreshToken);",
    ]),
    "get /departments": save([
        "const roads = body.data.find((item) => item.name === 'Roads & Transport') || body.data[0];",
        "if (roads) pm.collectionVariables.set('departmentId', roads.id);",
    ]),
    "get /categories": save([
        "const pothole = body.data.find((item) => item.name === 'Pothole') || body.data.find((item) => item.type === 'COMPLAINT');",
        "const service = body.data.find((item) => item.type === 'SERVICE');",
        "if (pothole) pm.collectionVariables.set('categoryId', pothole.id);",
        "if (service) pm.collectionVariables.set('serviceCategoryId', service.id);",
    ]),
    "post /complaints": save([
        "pm.collectionVariables.set('complaintId', body.data.id);",
        "pm.collectionVariables.set('trackingCode', body.data.trackingCode);",
    ]),
    "post /complaints/{id}/attachments": save(["if (body.data.length) pm.collectionVariables.set('attachmentId', body.data[0].id);"]),
    "post /complaints/{id}/comments": save(["pm.collectionVariables.set('commentId', body.data.id);"]),
    "post /payments/initiate": save([
        "pm.collectionVariables.set('paymentId', body.data.payment.id);",
        "const reference = body.data.payment.provider === 'SSLCOMMERZ' ? 'tranId' : 'sessionId';",
        "pm.collectionVariables.set(reference, body.data.payment.transactionId);",
        "console.log('Open this link in a browser to pay:', body.data.checkoutUrl);",
    ]),
    "post /admin/users": save(["pm.collectionVariables.set('userId', body.data.id);"]),
    "get /notifications": save(["if (body.data.length) pm.collectionVariables.set('notificationId', body.data[0].id);"]),
};

const demo = {
    admin: { email: "admin@citycare.com", password: "Admin12345" },
    staff: { email: "roads.staff@citycare.com", password: "Staff12345" },
    citizen: { email: "citizen@citycare.com", password: "Citizen12345" },
};

const complaintBody = {
    title: "Deep pothole in front of the school gate",
    description: "A deep pothole on the main road is causing accidents during school hours.",
    categoryId: "{{categoryId}}",
    address: "Road 8, near Dhanmondi Boys School",
    area: "Dhanmondi",
    priority: "HIGH",
    latitude: 23.7461,
    longitude: 90.3742,
};

const demoSteps: [string, string, string, IRequestOptions][] = [
    ["Login as admin", "post", "/auth/login", { body: demo.admin, test: saveLogin("adminToken") }],
    [
        "Login as staff",
        "post",
        "/auth/login",
        { body: demo.staff, test: saveLogin("staffToken", ["pm.collectionVariables.set('staffId', body.data.user.id);"]) },
    ],
    ["Login as citizen", "post", "/auth/login", { body: demo.citizen, test: savers["post /auth/login"] }],
    ["Get categories", "get", "/categories", { test: savers["get /categories"] }],
    [
        "CRUD: admin creates a department",
        "post",
        "/departments",
        {
            token: "adminToken",
            body: {
                name: "Public Health {{$randomInt}}",
                description: "Mosquito control and public toilets",
                contactEmail: "health@citycare.com",
            },
            test: save(["pm.collectionVariables.set('newDepartmentId', body.data.id);"]),
        },
    ],
    ["CRUD: anyone reads it", "get", "/departments/{{newDepartmentId}}", {}],
    [
        "CRUD: admin updates it",
        "patch",
        "/departments/{{newDepartmentId}}",
        { token: "adminToken", body: { description: "Mosquito control, public toilets and food safety" } },
    ],
    ["CRUD: admin removes it (soft delete)", "delete", "/departments/{{newDepartmentId}}", { token: "adminToken" }],
    ["CRUD: it is gone now (404)", "get", "/departments/{{newDepartmentId}}", { test: expectStatus(404) }],
    [
        "Citizen submits a complaint",
        "post",
        "/complaints",
        { token: "citizenToken", body: complaintBody, test: savers["post /complaints"] },
    ],
    ["Anyone tracks it with the tracking code", "get", "/complaints/track/{{trackingCode}}", {}],
    [
        "Admin assigns it to the staff member",
        "post",
        "/complaints/{{complaintId}}/assign",
        { token: "adminToken", body: { staffId: "{{staffId}}", note: "Please check today" } },
    ],
    ["Staff sees the new job in the notifications", "get", "/notifications/unread-count", { token: "staffToken" }],
    [
        "Citizen sends a message on the complaint",
        "post",
        "/complaints/{{complaintId}}/comments",
        {
            token: "citizenToken",
            body: { body: "The hole is next to the school gate, on the left side." },
            test: savers["post /complaints/{id}/comments"],
        },
    ],
    ["Staff starts the work", "patch", "/complaints/{{complaintId}}/status", { token: "staffToken", body: { status: "IN_PROGRESS" } }],
    [
        "Staff resolves it",
        "patch",
        "/complaints/{{complaintId}}/status",
        { token: "staffToken", body: { status: "RESOLVED", note: "The pothole was filled and the road was levelled." } },
    ],
    ["Citizen reads the notifications", "get", "/notifications", { token: "citizenToken", test: savers["get /notifications"] }],
    [
        "Citizen gives feedback",
        "post",
        "/complaints/{{complaintId}}/feedback",
        { token: "citizenToken", body: { rating: 5, comment: "Fixed quickly, thank you." } },
    ],
    [
        "Citizen creates a paid service request",
        "post",
        "/complaints",
        {
            token: "citizenToken",
            body: {
                ...complaintBody,
                title: "Pickup needed for an old sofa and a fridge",
                description: "Two large items need to be collected from the ground floor.",
                categoryId: "{{serviceCategoryId}}",
                priority: "LOW",
            },
            test: save(["pm.collectionVariables.set('serviceRequestId', body.data.id);"]),
        },
    ],
    [
        "Citizen starts the Stripe payment",
        "post",
        "/payments/initiate",
        {
            token: "citizenToken",
            body: { complaintId: "{{serviceRequestId}}" },
            test: savers["post /payments/initiate"],
            description:
                "Copy checkoutUrl from the response, open it in a browser and pay with the test card 4242 4242 4242 4242. Send method BKASH or NAGAD to pay through SSLCommerz instead, then verify with tranId.",
        },
    ],
    ["Citizen verifies the payment", "post", "/payments/verify", { token: "citizenToken", body: { sessionId: "{{sessionId}}" } }],
    ["Citizen sees the payment history", "get", "/payments", { token: "citizenToken" }],
    ["Role check: citizen opens an admin route (403)", "get", "/admin/users", { token: "citizenToken", test: expectStatus(403) }],
    [
        "Role check: staff creates a department (403)",
        "post",
        "/departments",
        { token: "staffToken", body: { name: "Not allowed" }, test: expectStatus(403) },
    ],
    ["No token (401)", "get", "/users/me", { test: expectStatus(401) }],
    [
        "Validation error (400)",
        "post",
        "/auth/register",
        { body: { name: "A", email: "not-an-email", password: "123" }, test: expectStatus(400) },
    ],
    ["Not found (404)", "get", "/complaints/3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d", { token: "adminToken", test: expectStatus(404) }],
    ["Admin dashboard stats", "get", "/admin/dashboard-stats", { token: "adminToken" }],
    ["Admin audit logs", "get", "/admin/audit-logs?limit=10", { token: "adminToken" }],
];

const demoFlow: IFolder = {
    name: "Demo flow (run from top to bottom)",
    description: "The full journey with the seeded demo accounts. Every request saves what the next one needs.",
    item: demoSteps.map(([name, method, apiPath, options], index) =>
        request(`${String(index + 1).padStart(2, "0")} ${name}`, method, apiPath, options)
    ),
};

const folders = new Map<string, IFolder>();

for (const endpoint of endpoints) {
    const folder = folders.get(endpoint.tag) ?? { name: endpoint.tag, item: [] };
    const key = `${endpoint.method} ${endpoint.path}`;
    const queryValues: Record<string, string> = { session_id: "{{sessionId}}" };
    const query = (endpoint.query ?? []).map((name) => (queryValues[name] ? ([name, queryValues[name]] as [string, string]) : name));

    folder.item.push(
        request(endpoint.summary, endpoint.method, resolvePath(endpoint.path), {
            token: tokenFor[endpoint.access],
            body: fillBody(endpoint.body, endpoint.path),
            query,
            test: savers[key],
            multipart: endpoint.multipart,
            description: `Access: ${endpoint.access}.${endpoint.note ? ` ${endpoint.note}` : ""}`,
        })
    );
    folders.set(endpoint.tag, folder);
}

const tags = [...TAG_ORDER.filter((tag) => folders.has(tag)), ...[...folders.keys()].filter((tag) => !TAG_ORDER.includes(tag))];
const variables = [
    "adminToken",
    "staffToken",
    "citizenToken",
    "refreshToken",
    "staffId",
    "userId",
    "departmentId",
    "categoryId",
    "serviceCategoryId",
    "newDepartmentId",
    "complaintId",
    "trackingCode",
    "serviceRequestId",
    "attachmentId",
    "commentId",
    "paymentId",
    "sessionId",
    "tranId",
    "messageId",
    "notificationId",
    "cronSecret",
];

const collection = {
    info: {
        name: "CityCare API",
        description:
            'All endpoints of the CityCare backend (city complaint and service request platform).\n\nStart with the folder "Demo flow". Its first three requests login as admin, staff and citizen and save the tokens. The other requests use the saved tokens and ids automatically.\n\nChange the collection variable baseUrl to test another server.',
        schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    item: [demoFlow, ...tags.map((tag) => folders.get(tag) as IFolder)],
    variable: [{ key: "baseUrl", value: BASE_URL }, ...variables.map((key) => ({ key, value: "" }))],
};

mkdirSync(path.dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(collection, null, 2)}\n`);

const requests = collection.item.reduce((sum, folder) => sum + folder.item.length, 0);

console.log(`Postman collection written: ${collection.item.length} folders, ${requests} requests, ${endpoints.length} endpoints`);
