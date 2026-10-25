type TMethod = "get" | "post" | "patch" | "delete";
type TAccess = "Public" | "Any logged in user" | "Citizen" | "Staff" | "Admin" | "Citizen or Admin" | "Staff or Admin" | "Stripe";

export interface IEndpointDoc {
    method: TMethod;
    path: string;
    tag: string;
    summary: string;
    access: TAccess;
    note?: string;
    query?: string[];
    body?: Record<string, unknown>;
    multipart?: boolean;
    successStatus?: number;
}

const uuid = "3f1b2c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const pagination = ["page", "limit", "sortOrder"];

export const endpoints: IEndpointDoc[] = [
    {
        method: "get",
        path: "/health",
        tag: "System",
        summary: "Check the API, the database and redis",
        access: "Public",
        note: "Answers 503 when the database is not reachable, so it can be used as a readiness probe.",
    },
    {
        method: "get",
        path: "/health/live",
        tag: "System",
        summary: "Check that the API process is running",
        access: "Public",
        note: "Does not touch the database. Use it as a liveness probe.",
    },
    {
        method: "post",
        path: "/auth/register",
        tag: "Auth",
        summary: "Register a citizen account",
        access: "Public",
        body: { name: "Karim Uddin", email: "karim@example.com", password: "Citizen12345", phone: "+8801712345678" },
        successStatus: 201,
    },
    {
        method: "post",
        path: "/auth/login",
        tag: "Auth",
        summary: "Login with email and password",
        access: "Public",
        note: "Returns an access token (JWT) and a refresh token.",
        body: { email: "citizen@citycare.com", password: "Citizen12345" },
    },
    {
        method: "post",
        path: "/auth/refresh-token",
        tag: "Auth",
        summary: "Get a new access token",
        access: "Public",
        note: "The refresh token is rotated. The old one stops working.",
        body: { refreshToken: "refresh-token-from-login" },
    },
    {
        method: "post",
        path: "/auth/logout",
        tag: "Auth",
        summary: "Logout and revoke the refresh token",
        access: "Public",
        body: { refreshToken: "refresh-token-from-login" },
    },
    {
        method: "post",
        path: "/auth/change-password",
        tag: "Auth",
        summary: "Change own password",
        access: "Any logged in user",
        body: { currentPassword: "Citizen12345", newPassword: "NewPass12345" },
    },
    {
        method: "post",
        path: "/auth/forgot-password",
        tag: "Auth",
        summary: "Send a password reset email",
        access: "Public",
        body: { email: "citizen@citycare.com" },
    },
    {
        method: "post",
        path: "/auth/reset-password",
        tag: "Auth",
        summary: "Set a new password with the reset token",
        access: "Public",
        body: { token: "reset-token-from-the-email", newPassword: "NewPass12345" },
    },
    {
        method: "get",
        path: "/auth/google",
        tag: "Auth",
        summary: "Start the Google login",
        access: "Public",
        note: "Open in a browser. It redirects to Google. Use format=json to get the URL as JSON. A frontend can pass redirect to get a one time code back.",
        query: ["redirect", "format"],
    },
    {
        method: "get",
        path: "/auth/google/callback",
        tag: "Auth",
        summary: "Google sends the user back here",
        access: "Public",
        note: "Without a redirect it returns the user and the tokens as JSON. With a redirect it sends the browser to the frontend with a one time code.",
        query: ["code", "state"],
    },
    {
        method: "post",
        path: "/auth/google",
        tag: "Auth",
        summary: "Login with a Google ID token",
        access: "Public",
        body: { idToken: "id-token-from-google-sign-in" },
    },
    {
        method: "post",
        path: "/auth/google/exchange",
        tag: "Auth",
        summary: "Exchange the one time Google login code for tokens",
        access: "Public",
        body: { code: "one-time-code-from-the-redirect" },
    },
    { method: "get", path: "/users/me", tag: "Users", summary: "Get own profile", access: "Any logged in user" },
    {
        method: "patch",
        path: "/users/me",
        tag: "Users",
        summary: "Update own profile",
        access: "Any logged in user",
        note: "A staff member can also send acceptsAssignments: false to pause new jobs while on leave.",
        body: { name: "Karim Uddin", phone: "+8801712345678", address: "House 12, Road 5, Dhanmondi" },
    },
    { method: "get", path: "/departments", tag: "Departments", summary: "Get all departments", access: "Public", note: "Cached in redis." },
    { method: "get", path: "/departments/{id}", tag: "Departments", summary: "Get one department with its categories", access: "Public" },
    {
        method: "post",
        path: "/departments",
        tag: "Departments",
        summary: "Create a department",
        access: "Admin",
        body: { name: "Public Health", description: "Mosquito control and public toilets", contactEmail: "health@citycare.com" },
        successStatus: 201,
    },
    {
        method: "patch",
        path: "/departments/{id}",
        tag: "Departments",
        summary: "Update a department",
        access: "Admin",
        body: { description: "Mosquito control, public toilets and food safety" },
    },
    { method: "delete", path: "/departments/{id}", tag: "Departments", summary: "Remove a department (soft delete)", access: "Admin" },
    {
        method: "get",
        path: "/categories",
        tag: "Categories",
        summary: "Get complaint and service categories",
        access: "Public",
        note: "Cached in redis. An admin can add includeInactive=true.",
        query: ["type", "departmentId", "searchTerm", "includeInactive"],
    },
    { method: "get", path: "/categories/{id}", tag: "Categories", summary: "Get one category", access: "Public" },
    {
        method: "post",
        path: "/categories",
        tag: "Categories",
        summary: "Create a category",
        access: "Admin",
        note: "A SERVICE category can have a fee. A COMPLAINT category is always free.",
        body: {
            name: "Mosquito spraying",
            description: "Spraying of one house",
            type: "SERVICE",
            fee: 10,
            slaHours: 48,
            departmentId: uuid,
        },
        successStatus: 201,
    },
    {
        method: "patch",
        path: "/categories/{id}",
        tag: "Categories",
        summary: "Update a category",
        access: "Admin",
        body: { fee: 12, isActive: true },
    },
    { method: "delete", path: "/categories/{id}", tag: "Categories", summary: "Remove a category (soft delete)", access: "Admin" },
    {
        method: "post",
        path: "/complaints",
        tag: "Complaints",
        summary: "Submit a complaint or a service request",
        access: "Citizen",
        note: "A free complaint is SUBMITTED at once. A paid service request starts as PENDING_PAYMENT.",
        body: {
            title: "Deep pothole in front of the school gate",
            description: "A deep pothole on the main road is causing accidents during school hours.",
            categoryId: uuid,
            address: "Road 8, near Dhanmondi Boys School",
            area: "Dhanmondi",
            priority: "HIGH",
            latitude: 23.7461,
            longitude: 90.3742,
        },
        successStatus: 201,
    },
    {
        method: "get",
        path: "/complaints",
        tag: "Complaints",
        summary: "List complaints with search, filters, sorting and pagination",
        access: "Any logged in user",
        note: "A citizen sees own complaints, a staff member sees assigned complaints, an admin sees everything.",
        query: [
            "searchTerm",
            "status",
            "priority",
            "type",
            "paymentStatus",
            "categoryId",
            "departmentId",
            "area",
            "overdue",
            "unassigned",
            "citizenId",
            "assignedStaffId",
            "from",
            "to",
            "sortBy",
            ...pagination,
        ],
    },
    {
        method: "get",
        path: "/complaints/track/{trackingCode}",
        tag: "Complaints",
        summary: "Track a complaint with its tracking code",
        access: "Public",
        note: "Shows the status and the timeline only. No personal data.",
    },
    {
        method: "get",
        path: "/complaints/{id}",
        tag: "Complaints",
        summary: "Get complaint details with the timeline",
        access: "Any logged in user",
    },
    {
        method: "patch",
        path: "/complaints/{id}",
        tag: "Complaints",
        summary: "Update a complaint",
        access: "Citizen or Admin",
        note: "The citizen can edit before it is assigned. An admin can only change the priority.",
        body: { title: "Deep pothole in front of the school main gate", priority: "URGENT" },
    },
    {
        method: "delete",
        path: "/complaints/{id}",
        tag: "Complaints",
        summary: "Remove a complaint (soft delete)",
        access: "Citizen or Admin",
    },
    {
        method: "post",
        path: "/complaints/{id}/assign",
        tag: "Complaints",
        summary: "Assign a complaint to a staff member",
        access: "Admin",
        note: "Leave staffId out to let the system pick the staff member with the fewest active complaints. A staff member has a capacity limit.",
        body: { staffId: uuid, note: "Please check today" },
    },
    {
        method: "patch",
        path: "/complaints/{id}/status",
        tag: "Complaints",
        summary: "Change the status of a complaint",
        access: "Staff or Admin",
        note: "Staff: ASSIGNED to IN_PROGRESS to RESOLVED. Admin: REJECTED or CLOSED. Rejecting a paid request refunds the fee.",
        body: { status: "RESOLVED", note: "The pothole was filled and the road was levelled." },
    },
    {
        method: "post",
        path: "/complaints/{id}/cancel",
        tag: "Complaints",
        summary: "Cancel own complaint before it is assigned",
        access: "Citizen",
        body: { reason: "It was fixed by the neighbours" },
    },
    {
        method: "post",
        path: "/complaints/{id}/reopen",
        tag: "Complaints",
        summary: "Reopen a resolved complaint",
        access: "Citizen",
        body: { reason: "The pothole opened again after two days." },
    },
    {
        method: "post",
        path: "/complaints/{id}/transfer",
        tag: "Complaints",
        summary: "Transfer a complaint to another department",
        access: "Admin",
        body: { departmentId: uuid, note: "This belongs to the water department" },
    },
    {
        method: "post",
        path: "/complaints/{id}/feedback",
        tag: "Complaints",
        summary: "Give feedback on a resolved complaint",
        access: "Citizen",
        note: "Feedback closes the complaint.",
        body: { rating: 5, comment: "Fixed quickly, thank you." },
        successStatus: 201,
    },
    {
        method: "post",
        path: "/complaints/{id}/attachments",
        tag: "Complaints",
        summary: "Upload images to a complaint",
        access: "Any logged in user",
        note: 'Send form-data with the field "images". JPG, PNG or WEBP, 2 MB each, 2 files per request, 6 per complaint.',
        multipart: true,
        successStatus: 201,
    },
    {
        method: "delete",
        path: "/complaints/{id}/attachments/{attachmentId}",
        tag: "Complaints",
        summary: "Remove an image from a complaint",
        access: "Any logged in user",
    },
    {
        method: "post",
        path: "/payments/initiate",
        tag: "Payments",
        summary: "Create a Stripe Checkout session for a service request",
        access: "Citizen",
        note: "Open checkoutUrl in a browser to pay. A frontend can send clientUrl to get the user back on its own pages.",
        body: { complaintId: uuid },
        successStatus: 201,
    },
    {
        method: "get",
        path: "/payments/success",
        tag: "Payments",
        summary: "Stripe sends the user here after a successful payment",
        access: "Public",
        note: "The server checks the session with Stripe before it completes the payment.",
        query: ["session_id"],
    },
    {
        method: "get",
        path: "/payments/cancel",
        tag: "Payments",
        summary: "Stripe sends the user here when the checkout is cancelled",
        access: "Public",
        query: ["session_id"],
    },
    {
        method: "post",
        path: "/payments/verify",
        tag: "Payments",
        summary: "Verify a checkout session with Stripe",
        access: "Citizen",
        body: { sessionId: "cs_test_a1b2c3d4" },
    },
    {
        method: "post",
        path: "/payments/webhook",
        tag: "Payments",
        summary: "Stripe webhook",
        access: "Stripe",
        note: "Called by Stripe only. The signature is verified with STRIPE_WEBHOOK_SECRET.",
    },
    {
        method: "get",
        path: "/payments",
        tag: "Payments",
        summary: "Get the payment history",
        access: "Citizen or Admin",
        query: ["status", "complaintId", "citizenId", ...pagination],
    },
    { method: "get", path: "/payments/{id}", tag: "Payments", summary: "Get one payment", access: "Citizen or Admin" },
    {
        method: "post",
        path: "/payments/{id}/refund",
        tag: "Payments",
        summary: "Refund a payment of a rejected or cancelled request",
        access: "Admin",
        note: "Refunds are automatic. This endpoint is for a retry when an automatic refund failed.",
    },
    { method: "get", path: "/stats/public", tag: "Stats", summary: "Get public statistics", access: "Public", note: "Cached in redis." },
    {
        method: "get",
        path: "/stats/me",
        tag: "Stats",
        summary: "Get the numbers for the dashboard of the logged in user",
        access: "Any logged in user",
        note: "Staff also get their weekly resolved jobs, rating breakdown, on time rate and availability.",
    },
    {
        method: "post",
        path: "/contact",
        tag: "Contact",
        summary: "Send a message to the city team",
        access: "Public",
        note: "Rate limited. The sender gets a confirmation email.",
        body: {
            name: "Rina Das",
            email: "rina@example.com",
            topic: "PAYMENT",
            subject: "Refund question",
            message: "I paid twice for one request by mistake.",
        },
        successStatus: 201,
    },
    {
        method: "get",
        path: "/admin/users",
        tag: "Admin",
        summary: "Get all users with search, filters and pagination",
        access: "Admin",
        query: ["searchTerm", "role", "status", "departmentId", "sortBy", ...pagination],
    },
    {
        method: "post",
        path: "/admin/users",
        tag: "Admin",
        summary: "Create a staff or admin account",
        access: "Admin",
        body: { name: "New Staff", email: "new.staff@citycare.com", password: "Staff12345", role: "STAFF", departmentId: uuid },
        successStatus: 201,
    },
    {
        method: "patch",
        path: "/admin/users/{id}/role",
        tag: "Admin",
        summary: "Change the role of a user",
        access: "Admin",
        body: { role: "STAFF", departmentId: uuid },
    },
    {
        method: "patch",
        path: "/admin/users/{id}/status",
        tag: "Admin",
        summary: "Block or unblock a user",
        access: "Admin",
        body: { status: "BLOCKED", reason: "Spam complaints" },
    },
    { method: "delete", path: "/admin/users/{id}", tag: "Admin", summary: "Remove a user (soft delete)", access: "Admin" },
    {
        method: "get",
        path: "/admin/staff-workload",
        tag: "Admin",
        summary: "Get the staff members with their active complaints",
        access: "Admin",
        query: ["departmentId"],
    },
    { method: "get", path: "/admin/dashboard-stats", tag: "Admin", summary: "Get the platform statistics", access: "Admin" },
    {
        method: "get",
        path: "/admin/audit-logs",
        tag: "Admin",
        summary: "Get the audit logs",
        access: "Admin",
        query: ["action", "entityType", "entityId", "actorId", "from", "to", ...pagination],
    },
    {
        method: "get",
        path: "/admin/messages",
        tag: "Admin",
        summary: "Get the contact messages",
        access: "Admin",
        query: ["status", "topic", "searchTerm", ...pagination],
    },
    {
        method: "post",
        path: "/admin/messages/{id}/reply",
        tag: "Admin",
        summary: "Reply to a contact message by email",
        access: "Admin",
        body: { reply: "We checked it. The second payment was refunded today." },
    },
    {
        method: "patch",
        path: "/admin/messages/{id}/status",
        tag: "Admin",
        summary: "Close or reopen a contact message",
        access: "Admin",
        body: { status: "CLOSED" },
    },
];

const errorResponse = (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } },
});

const buildPaths = () => {
    const paths: Record<string, Record<string, unknown>> = {};

    for (const endpoint of endpoints) {
        const isSecured = endpoint.access !== "Public" && endpoint.access !== "Stripe";
        const pathParams = [...endpoint.path.matchAll(/\{(\w+)\}/g)].map((match) => match[1] as string);

        const parameters = [
            ...pathParams.map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
            ...(endpoint.query ?? []).map((name) => ({ name, in: "query", required: false, schema: { type: "string" } })),
        ];

        const requestBody = endpoint.multipart
            ? {
                  required: true,
                  content: {
                      "multipart/form-data": {
                          schema: {
                              type: "object",
                              properties: { images: { type: "array", items: { type: "string", format: "binary" } } },
                          },
                      },
                  },
              }
            : endpoint.body
              ? { required: true, content: { "application/json": { schema: { type: "object", example: endpoint.body } } } }
              : undefined;

        paths[endpoint.path] = {
            ...paths[endpoint.path],
            [endpoint.method]: {
                tags: [endpoint.tag],
                summary: endpoint.summary,
                description: `Access: ${endpoint.access}.${endpoint.note ? ` ${endpoint.note}` : ""}`,
                ...(isSecured ? { security: [{ bearerAuth: [] }] } : {}),
                ...(parameters.length ? { parameters } : {}),
                ...(requestBody ? { requestBody } : {}),
                responses: {
                    [endpoint.successStatus ?? 200]: {
                        description: "Success",
                        content: { "application/json": { schema: { $ref: "#/components/schemas/SuccessResponse" } } },
                    },
                    400: errorResponse("Validation error or invalid request"),
                    ...(isSecured ? { 401: errorResponse("Missing or invalid token"), 403: errorResponse("No permission") } : {}),
                    404: errorResponse("Resource not found"),
                    429: errorResponse("Too many requests"),
                },
            },
        };
    }

    return paths;
};

export const swaggerDocument = {
    openapi: "3.0.3",
    info: {
        title: "CityCare API",
        version: "1.0.0",
        description:
            "Backend API of a city complaint and service request platform. Login first, then press Authorize and paste the accessToken to use the protected endpoints.",
    },
    servers: [{ url: "/api/v1" }],
    tags: [...new Set(endpoints.map((endpoint) => endpoint.tag))].map((name) => ({ name })),
    components: {
        securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
        schemas: {
            SuccessResponse: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: true },
                    message: { type: "string", example: "Operation successful" },
                    meta: {
                        type: "object",
                        properties: {
                            page: { type: "integer", example: 1 },
                            limit: { type: "integer", example: 10 },
                            total: { type: "integer", example: 25 },
                            totalPages: { type: "integer", example: 3 },
                        },
                    },
                    data: {},
                },
            },
            ErrorResponse: {
                type: "object",
                properties: {
                    success: { type: "boolean", example: false },
                    message: { type: "string", example: "Validation failed" },
                    errors: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                field: { type: "string", example: "email" },
                                message: { type: "string", example: "A valid email is required" },
                            },
                        },
                    },
                },
            },
        },
    },
    paths: buildPaths(),
};

export const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>CityCare API Docs</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
    <div id="swagger-ui"></div>
    <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
        window.onload = () => {
            window.ui = SwaggerUIBundle({
                url: "/api/v1/docs/openapi.json",
                dom_id: "#swagger-ui",
                persistAuthorization: true,
            });
        };
    </script>
</body>
</html>`;
