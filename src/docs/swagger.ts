type TMethod = "get" | "post" | "patch" | "delete";
type TAccess =
    | "Public"
    | "Any logged in user"
    | "Citizen"
    | "Staff"
    | "Admin"
    | "Citizen or Admin"
    | "Staff or Admin"
    | "Stripe"
    | "SSLCommerz"
    | "Scheduler";

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
        path: "/jobs/sla-check",
        tag: "System",
        summary: "Escalate complaints that missed their deadline",
        access: "Scheduler",
        note: "Called once a day by Vercel Cron with Authorization: Bearer CRON_SECRET. Each overdue open complaint is escalated once: its priority goes up one level, the timeline and the audit log get a row, and the admins and the staff member are notified. Read notifications older than 90 days are removed.",
    },
    {
        method: "get",
        path: "/jobs/payment-check",
        tag: "System",
        summary: "Check bKash and Nagad payments that are still open",
        access: "Scheduler",
        note: "Called once a day by Vercel Cron with Authorization: Bearer CRON_SECRET. Every bKash or Nagad payment that is still PENDING after 45 minutes is checked with SSLCommerz. A paid one is completed, an unpaid one is cancelled. Returns how many were checked, settled and closed.",
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
            isPublic: true,
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
            "escalated",
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
        note: "Shows the status and the timeline. No personal data. A report its citizen made public also shows its id, a rounded location and the number of supporters. With an access token the answer also says if the report is yours (isMine) and if you support it (supportedByMe).",
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
        method: "get",
        path: "/payments/methods",
        tag: "Payments",
        summary: "Get the payment methods",
        access: "Public",
        note: "Card goes through Stripe, bKash and Nagad go through SSLCommerz. available is false when the keys of that provider are not set on the server.",
    },
    {
        method: "post",
        path: "/payments/initiate",
        tag: "Payments",
        summary: "Start a card, bKash or Nagad checkout for a service request",
        access: "Citizen",
        note: "method is CARD (Stripe Checkout, the default), BKASH or NAGAD (SSLCommerz, straight to that wallet). Open checkoutUrl in a browser to pay. A frontend can send clientUrl to get the user back on its own pages.",
        body: { complaintId: uuid, method: "BKASH" },
        successStatus: 201,
    },
    {
        method: "get",
        path: "/payments/success",
        tag: "Payments",
        summary: "Check a payment after a successful checkout",
        access: "Public",
        note: "Stripe sends the user here with session_id. Send tran_id for a bKash or Nagad payment. The server asks the provider before it completes the payment.",
        query: ["session_id", "tran_id"],
    },
    {
        method: "get",
        path: "/payments/cancel",
        tag: "Payments",
        summary: "Close a checkout that the user left",
        access: "Public",
        note: "Stripe sends the user here with session_id. Send tran_id for a bKash or Nagad payment. A payment that was paid after all is completed instead.",
        query: ["session_id", "tran_id"],
    },
    {
        method: "post",
        path: "/payments/verify",
        tag: "Payments",
        summary: "Verify a payment with Stripe or SSLCommerz",
        access: "Citizen",
        note: "Send sessionId for a card payment or tranId for a bKash or Nagad payment.",
        body: { tranId: "CC0F3A9B27C4D15E8A6B90C2D4" },
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
        method: "post",
        path: "/payments/sslcommerz/success",
        tag: "Payments",
        summary: "SSLCommerz sends the user here after a bKash or Nagad payment",
        access: "SSLCommerz",
        note: "SSLCommerz posts a form with tran_id. The server never trusts the form: it looks the transaction up and validates it with the SSLCommerz API, then checks the amount and the currency. With an allowed client in the query it redirects (303) to <client>/payment/success?tran_id=..., otherwise it answers with JSON.",
        query: ["client"],
        body: { tran_id: "CC0F3A9B27C4D15E8A6B90C2D4" },
    },
    {
        method: "post",
        path: "/payments/sslcommerz/fail",
        tag: "Payments",
        summary: "SSLCommerz sends the user here when the payment failed",
        access: "SSLCommerz",
        note: "The payment becomes FAILED unless SSLCommerz reports it as paid. Redirects to <client>/payment/cancel?tran_id=... when an allowed client is in the query.",
        query: ["client"],
        body: { tran_id: "CC0F3A9B27C4D15E8A6B90C2D4" },
    },
    {
        method: "post",
        path: "/payments/sslcommerz/cancel",
        tag: "Payments",
        summary: "SSLCommerz sends the user here when the payment was cancelled",
        access: "SSLCommerz",
        note: "The payment becomes CANCELLED unless SSLCommerz reports it as paid. Redirects to <client>/payment/cancel?tran_id=... when an allowed client is in the query.",
        query: ["client"],
        body: { tran_id: "CC0F3A9B27C4D15E8A6B90C2D4" },
    },
    {
        method: "post",
        path: "/payments/sslcommerz/ipn",
        tag: "Payments",
        summary: "SSLCommerz instant payment notification",
        access: "SSLCommerz",
        note: "Called by SSLCommerz server to server, so a payment is completed even if the user closes the browser. The status in the form is only a hint: the server checks the transaction with the SSLCommerz API.",
        body: { tran_id: "CC0F3A9B27C4D15E8A6B90C2D4", status: "VALID" },
    },
    {
        method: "get",
        path: "/payments",
        tag: "Payments",
        summary: "Get the payment history",
        access: "Citizen or Admin",
        query: ["status", "method", "complaintId", "citizenId", ...pagination],
    },
    { method: "get", path: "/payments/{id}", tag: "Payments", summary: "Get one payment", access: "Citizen or Admin" },
    {
        method: "post",
        path: "/payments/{id}/refund",
        tag: "Payments",
        summary: "Refund a payment of a rejected or cancelled request",
        access: "Admin",
        note: "Refunds are automatic and go back through the provider of the payment (Stripe or SSLCommerz). This endpoint is for a retry when an automatic refund failed. An extra payment for a request that was paid twice can be refunded at any time.",
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
        method: "get",
        path: "/complaints/map",
        tag: "Complaints",
        summary: "Get complaints that have a location, for a map",
        access: "Any logged in user",
        note: "An admin sees every complaint, a staff member the assigned jobs and a citizen their own reports. Open ones by default.",
        query: ["status", "departmentId", "limit"],
    },
    {
        method: "get",
        path: "/complaints/public",
        tag: "Community",
        summary: "List public reports for the city map",
        access: "Public",
        note: "Open or recently resolved complaints that their citizen made public and that have a location. No personal data, coordinates rounded to about 10 meters. Cached for one minute and cleared when a report changes. With an access token each report also says if it is yours (isMine) and if you support it (supportedByMe).",
        query: ["status", "categoryId", "departmentId", "minLat", "maxLat", "minLng", "maxLng", "limit"],
    },
    {
        method: "get",
        path: "/complaints/nearby",
        tag: "Community",
        summary: "Find open public reports near a spot",
        access: "Any logged in user",
        note: "The report wizard uses it to show possible duplicates before a new report is sent. Up to 5 reports, closest first.",
        query: ["latitude", "longitude", "radius", "categoryId"],
    },
    {
        method: "post",
        path: "/complaints/{id}/support",
        tag: "Community",
        summary: "Support a public report that affects you too",
        access: "Citizen",
        note: "Sending it twice changes nothing. The owner is told at 1, 5, 10, 25, 50 and 100 supporters.",
    },
    {
        method: "delete",
        path: "/complaints/{id}/support",
        tag: "Community",
        summary: "Withdraw your support",
        access: "Citizen",
    },
    {
        method: "get",
        path: "/complaints/{id}/comments",
        tag: "Complaints",
        summary: "Get the messages on a complaint",
        access: "Any logged in user",
        note: "Whoever can open the complaint can read its messages. Citizens do not see the internal notes of the city team.",
    },
    {
        method: "post",
        path: "/complaints/{id}/comments",
        tag: "Complaints",
        summary: "Send a message or an internal note on a complaint",
        access: "Any logged in user",
        note: "Staff and admins can set internal to true for a note the citizen does not see. The other people on the complaint get a notification.",
        body: { body: "The crew will come tomorrow morning. Please keep the gate open.", internal: false },
        successStatus: 201,
    },
    {
        method: "delete",
        path: "/complaints/{id}/comments/{commentId}",
        tag: "Complaints",
        summary: "Remove a message",
        access: "Any logged in user",
        note: "The author can remove a message within 15 minutes. An admin can remove any message.",
    },
    {
        method: "get",
        path: "/notifications",
        tag: "Notifications",
        summary: "List own notifications, newest first",
        access: "Any logged in user",
        note: "Created when a complaint is assigned, changes status, gets a comment, a rating or a payment, or misses its deadline.",
        query: ["unread", "page", "limit"],
    },
    {
        method: "get",
        path: "/notifications/unread-count",
        tag: "Notifications",
        summary: "Count own unread notifications",
        access: "Any logged in user",
    },
    {
        method: "patch",
        path: "/notifications/read-all",
        tag: "Notifications",
        summary: "Mark all own notifications as read",
        access: "Any logged in user",
    },
    {
        method: "patch",
        path: "/notifications/{id}/read",
        tag: "Notifications",
        summary: "Mark one notification as read",
        access: "Any logged in user",
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
        path: "/admin/exports/complaints",
        tag: "Admin",
        summary: "Download complaints as a CSV file",
        access: "Admin",
        note: "Takes the same filters as GET /complaints. Streams up to 10000 rows in batches, opens in Excel with UTF-8 names and protects against spreadsheet formulas. The download is written to the audit log.",
        query: ["searchTerm", "status", "priority", "type", "categoryId", "departmentId", "area", "overdue", "escalated", "from", "to"],
    },
    {
        method: "get",
        path: "/admin/exports/payments",
        tag: "Admin",
        summary: "Download payments as a CSV file",
        access: "Admin",
        note: "Takes the same filters as GET /payments. The download is written to the audit log.",
        query: ["status", "citizenId", "complaintId"],
    },
    {
        method: "post",
        path: "/admin/sla-check",
        tag: "Admin",
        summary: "Run the deadline check now",
        access: "Admin",
        note: "The same job as the daily scheduler: escalates complaints that missed their deadline and returns how many were escalated.",
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
        const isSecured = !["Public", "Stripe", "SSLCommerz"].includes(endpoint.access);
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
