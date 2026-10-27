# CityCare API

**The backend of a city complaint and service request platform**

[![CI](https://github.com/ebrahim2355/citycare-backend/actions/workflows/ci.yml/badge.svg)](https://github.com/ebrahim2355/citycare-backend/actions/workflows/ci.yml)
![Express 5](https://img.shields.io/badge/Express-5-000000?logo=express)
![Prisma 7](https://img.shields.io/badge/Prisma-7-2d3748?logo=prisma)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169e1?logo=postgresql&logoColor=white)
![TypeScript strict](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)

CityCare is an API for a city. A citizen reports a problem (a pothole, a broken street light, garbage that was not collected) or asks for a paid city service (bulk waste pickup, septic tank cleaning). The complaint goes to the right department, an admin assigns it to a staff member, the staff member resolves it and the citizen gives feedback. Every step is saved, every person involved is notified, and anyone can follow the complaint with a tracking code.

All features work from Postman or Swagger. The [CityCare frontend](https://github.com/ebrahim2355/citycare-frontend) (Next.js) is built on top of this API.

![The public issue map, powered by this API](docs/screenshots/issue-map.png)

## Links

| Item | Link |
| --- | --- |
| Live API | https://citycare-backend.vercel.app |
| API docs (Swagger) | https://citycare-backend.vercel.app/api/v1/docs |
| Health check | https://citycare-backend.vercel.app/api/v1/health |
| Live frontend | https://citycare-frontend-azure.vercel.app |
| Frontend repository | https://github.com/ebrahim2355/citycare-frontend |
| Postman collection | [postman/CityCare.postman_collection.json](./postman/CityCare.postman_collection.json) (106 requests) |

## Demo Credentials

The seed script creates these accounts.

| Role | Email | Password |
| --- | --- | --- |
| Admin | admin@citycare.com | Admin12345 |
| Staff (Roads & Transport) | roads.staff@citycare.com | Staff12345 |
| Citizen | citizen@citycare.com | Citizen12345 |

The seed also adds a staff member for every department, more citizens (`citizen2@citycare.com` to `citizen6@citycare.com`, same password), a few weeks of past complaints with real locations around Dhaka, messages, supporters and notifications, so every dashboard and map has data.

Stripe is in test mode. Pay with the card `4242 4242 4242 4242`, any future date and any CVC.

## Highlights

- **77 endpoints** for three roles, documented in Swagger and in a generated Postman collection.
- **A real workflow engine.** Every status change is checked against the allowed transitions and saved together with its timeline entry, its audit log row and its notifications in one transaction.
- **Safe under load.** Assignment, payment settlement and refunds lock rows in a fixed order, so parallel requests can neither break the staff capacity limit nor deadlock. If the database still reports a conflict, the client gets `409 Please try again`.
- **Maps and community.** Complaints can carry a location. Public reports feed a city map, the wizard finds the same problem nearby with a distance query, and citizens can support each other's reports.
- **Deadlines that escalate.** A daily scheduled job flags every open complaint that missed its deadline, raises its priority and tells the admins and the assigned staff member.
- **Built to be operated.** Structured JSON logs with a request id on every line, liveness and readiness checks, a Redis cache with exact invalidation, Redis rate limits that survive a Redis outage, and streamed CSV exports.
- **464 automated tests** (unit and integration against real PostgreSQL and Redis) run in GitHub Actions together with a check that the migrations match the schema.
- **Runs anywhere.** One `docker compose up` starts the API, PostgreSQL, Redis and a mail catcher. Production runs on Vercel with a cron job.

## The Problem

In many cities a citizen does not know where to report a problem, and after reporting nobody knows what happened to it. The city also has no clear picture of which department is slow and which area has the most problems.

CityCare solves this with one place for all complaints, automatic routing to the department, a clear status for every complaint, a deadline (SLA) for every category, escalation when a deadline is missed and reports for the admin.

## Roles

| Role | What this role can do |
| --- | --- |
| **Citizen** | Register and login, submit complaints with a location and photos, make a report public or private, support public reports nearby, pay the service fee, follow the timeline, message the city team, cancel, reopen and give feedback |
| **Staff** | See the complaints assigned to them and on a map, start the work, resolve with a note and proof photos, message the citizen or leave internal notes, pause new jobs while on leave |
| **Admin** | Manage departments, categories and users, assign and transfer complaints, reject complaints, run the deadline check, export data as CSV, answer contact messages, see statistics and audit logs |

A citizen registers by themselves. Staff and admin accounts are created by an admin. Every role has an in-app notification inbox.

## Features

**Accounts and security**

- Email and password login, Google login, JWT access tokens and rotating refresh tokens
- Role based access for the 3 roles on every protected route
- Password reset by email, bcrypt hashing, hashed refresh and reset tokens

**Complaints**

- Departments and categories. A category belongs to a department, so a new complaint goes to the right department automatically
- Free complaints and paid service requests, each with a tracking code
- Search, filters, sorting and pagination on every list, including an overdue and an escalated filter
- Assignment by the admin, or automatic assignment to the staff member with the fewest active complaints
- A capacity limit per staff member that holds under parallel requests. Staff on leave are skipped
- Status workflow with a timeline: who changed what and when
- Cancel, reopen (within 7 days, 2 times at most), transfer to another department and feedback that closes the complaint
- Photo upload with Multer and Cloudinary, checked by the real file content
- Soft delete for users, departments, categories, complaints, photos and messages

**Maps and community**

- Optional coordinates on every complaint, stored with checks and indexed
- A public map feed of open and recently fixed reports. Only reports their citizen made public, with no personal data and coordinates rounded to about 10 meters
- A nearby search for the report wizard: a bounding box narrows the rows and the database ranks them by distance before the limit
- Citizens support a public report that affects them too. The owner is told at 1, 5, 10, 25, 50 and 100 supporters
- A map feed for the dashboards that shows each role only its own part of the city

**Notifications and messages**

- An in-app inbox with 12 kinds of notification: new, assigned, moved, status changed, reopened, transferred, new message, feedback, payment received, refund, deadline missed and new supporter
- Notifications are written in the same transaction as the change they describe, so the inbox and the timeline always agree
- A message thread on every complaint. Staff and admins can post internal notes that the citizen never sees
- Email notifications with Nodemailer, with a list of domains that never get mail

**Deadlines**

- Every category has a target time. The due date starts when the complaint is submitted or paid
- A scheduled job escalates open complaints that missed their deadline: it raises the priority one level, writes the timeline and the audit log and notifies the admins and the assigned staff member. One failing complaint never stops the rest of the batch
- Admins can run the same check by hand. Reopening a complaint clears the flag and starts a new deadline
- The job also removes read notifications older than 90 days

**Payments**

- Stripe Checkout with webhook, success and cancel callbacks, verification and payment history
- Idempotent settlement: the callback, the webhook and the verify endpoint can all arrive and the payment completes once
- Automatic refund when a paid request is rejected or cancelled

**Admin tools**

- Statistics for the public, for each role and for the admin dashboard, with a 30 day trend and weekly staff performance
- Complaints and payments as CSV downloads with the same filters as the lists, streamed in batches and safe to open in Excel
- Contact form inbox. Admins reply by email from the dashboard
- Audit log of every important action, including every data export

**Operations**

- Structured JSON logs with pino. Every log line and every response has a request id, and query strings are never logged
- `GET /health/live` for liveness and `GET /health` for readiness (database and Redis)
- Redis cache for the catalog, the statistics and the public map, cleared exactly when the data changes
- Redis rate limits shared by all serverless instances, with a stricter limit on the auth routes
- When Redis is down the API answers within a few seconds without it, and the rate limits come back by themselves when Redis returns
- Works behind a server side frontend: with a shared key the API rate limits and logs the real client IP

## Tech Stack

| Part | Technology |
| --- | --- |
| Runtime and framework | Node.js 24, TypeScript, Express 5 |
| Package manager and build | Bun, tsup |
| Database | PostgreSQL with Prisma ORM 7 and the pg driver adapter |
| Validation | Zod |
| Authentication | Custom JWT, bcrypt, Google OAuth (google-auth-library) |
| Payment | Stripe Checkout |
| Cache and rate limit | Redis (ioredis, express-rate-limit, rate-limit-redis) |
| File upload | Multer, Cloudinary |
| Email | Nodemailer |
| Logging | pino and pino-http |
| Security | helmet, CORS allow list, rate limiting |
| Testing | Vitest, Supertest, fakes for Stripe, Cloudinary, Google and email |
| Lint and format | Biome |
| Docs | Swagger (OpenAPI), Postman |
| Delivery | GitHub Actions, Docker, Vercel with Vercel Cron, Dependabot |

## Architecture

Every request goes the same way:

```text
Route  ->  Middlewares (request id and logging, rate limit, auth, role, validation)  ->  Controller  ->  Service  ->  Prisma  ->  PostgreSQL
```

- The **route** file says which middlewares run and which controller handles the request
- The **controller** reads the request and sends the response. It has no business logic
- The **service** has the business logic and talks to the database
- All errors go to one global error handler, so every error has the same shape

```text
prisma
├── migrations          14 migrations
├── schema.prisma
└── seed.ts             with seed-geo.ts and seed-community.ts
src
├── app.ts
├── server.ts
├── config              environment variables, checked with Zod at startup
├── docs                Swagger document and docs route
├── errors              AppError class
├── lib                 prisma, redis, logger, stripe, google, mailer, cloudinary clients
├── middlewares         auth, cron auth, http logger, validation, rate limit, upload, error handler
├── modules
│   ├── auth            register, login, tokens, password reset, google login
│   ├── user            own profile
│   ├── department
│   ├── category
│   ├── complaint       complaints, assignment, workflow, photos, messages, community, escalation
│   ├── notification    in-app inbox and email templates
│   ├── payment         checkout, settlement (webhook), refund, history
│   ├── stats
│   ├── contact         contact form
│   ├── admin           user management, staff workload, messages
│   ├── export          CSV exports
│   ├── jobs            scheduled jobs
│   └── audit           audit log
├── routes
├── utils               response, pagination, cache, csv, geo, jwt, password, audit helper
└── validations
tests
├── unit
├── integration         the real app against PostgreSQL and Redis
├── fakes               Stripe, Cloudinary, Google and email
└── helpers
```

## Database Design

```mermaid
erDiagram
    DEPARTMENT ||--o{ CATEGORY : has
    DEPARTMENT ||--o{ USER : "has staff"
    DEPARTMENT ||--o{ COMPLAINT : handles
    CATEGORY ||--o{ COMPLAINT : classifies
    USER ||--o{ COMPLAINT : "submits (citizen)"
    USER ||--o{ COMPLAINT : "is assigned (staff)"
    USER ||--o{ REFRESH_TOKEN : owns
    USER ||--o{ AUDIT_LOG : "acts in"
    USER ||--o{ NOTIFICATION : receives
    COMPLAINT ||--o{ COMPLAINT_UPDATE : "has timeline"
    COMPLAINT ||--o{ COMPLAINT_ATTACHMENT : "has photos"
    COMPLAINT ||--o{ COMPLAINT_COMMENT : "has messages"
    COMPLAINT ||--o{ COMPLAINT_SUPPORT : "is supported by"
    COMPLAINT ||--o{ NOTIFICATION : "is about"
    COMPLAINT ||--o{ PAYMENT : "is paid by"
    COMPLAINT ||--o| FEEDBACK : receives
    USER ||--o{ COMPLAINT_SUPPORT : gives
    USER ||--o{ COMPLAINT_COMMENT : writes
    USER ||--o{ PAYMENT : pays
    USER ||--o{ FEEDBACK : gives
    USER ||--o{ CONTACT_MESSAGE : "replies to"

    USER {
        string id PK
        string email UK
        enum role "CITIZEN, STAFF, ADMIN"
        enum status "ACTIVE, BLOCKED"
        string departmentId FK
        boolean acceptsAssignments
        datetime deletedAt
    }
    DEPARTMENT {
        string id PK
        string name UK
        datetime deletedAt
    }
    CATEGORY {
        string id PK
        string name UK
        enum type "COMPLAINT, SERVICE"
        decimal fee
        int slaHours
        string departmentId FK
    }
    COMPLAINT {
        string id PK
        string trackingCode UK
        enum status
        enum priority
        enum paymentStatus
        float latitude
        float longitude
        boolean isPublic
        string citizenId FK
        string assignedStaffId FK
        datetime dueAt
        datetime escalatedAt
        datetime deletedAt
    }
    COMPLAINT_UPDATE {
        string id PK
        string complaintId FK
        string actorId FK
        enum fromStatus
        enum toStatus
        string note
    }
    COMPLAINT_COMMENT {
        string id PK
        string complaintId FK
        string authorId FK
        boolean isInternal
        datetime deletedAt
    }
    COMPLAINT_SUPPORT {
        string complaintId PK
        string userId PK
    }
    NOTIFICATION {
        string id PK
        string userId FK
        enum type
        string complaintId FK
        datetime readAt
    }
    PAYMENT {
        string id PK
        string complaintId FK
        decimal amount
        enum status
        string transactionId UK
    }
    FEEDBACK {
        string id PK
        string complaintId UK
        int rating
    }
    COMPLAINT_ATTACHMENT {
        string id PK
        string complaintId FK
        enum kind "EVIDENCE, RESOLUTION"
        string publicId UK
    }
    CONTACT_MESSAGE {
        string id PK
        enum status
        string repliedById FK
    }
    REFRESH_TOKEN {
        string id PK
        string tokenHash UK
        datetime revokedAt
    }
    AUDIT_LOG {
        string id PK
        string actorId FK
        string action
        json metadata
    }
```

- **Constraints**: unique email, tracking code, token hash and Stripe session id. Check constraints in the database for the fee, the SLA hours, the rating (1 to 5), the payment amount and the coordinates
- **Indexes**: on the columns of every filter, for example `(citizenId, status)`, `(assignedStaffId, status)`, `(status, dueAt)`, `(isPublic, status)`, `(latitude, longitude)`, `(userId, readAt)` and `createdAt`
- **Transactions**: every status change saves the complaint, the timeline row, the audit log and the notifications together
- **Soft delete**: a `deletedAt` column. Deleted rows stay in the database and are hidden from every query
- **Migrations and seed**: 14 migrations in `prisma/migrations`, one for each feature, and an idempotent seed script

## Concurrency and Consistency

- Status changes, payment settlement and refunds lock the complaint row with `SELECT ... FOR UPDATE`, so two requests cannot change the same complaint at the same time
- Assignment locks the staff rows with `FOR NO KEY UPDATE`, ordered by id. The capacity check then always sees the latest workload, and the lock does not block the foreign key checks of notification and timeline inserts, which keeps a reassignment and an automatic assignment from deadlocking
- Payment settlement is idempotent, and a support is counted once per citizen by a composite primary key
- If PostgreSQL still reports a deadlock or a serialization failure, the API answers `409` with "Please try again" instead of a server error

## Complaint Workflow

```mermaid
stateDiagram-v2
    [*] --> SUBMITTED: free complaint
    [*] --> PENDING_PAYMENT: paid service request
    PENDING_PAYMENT --> SUBMITTED: payment completed
    PENDING_PAYMENT --> CANCELLED: citizen cancels
    SUBMITTED --> ASSIGNED: admin assigns
    SUBMITTED --> CANCELLED: citizen cancels
    ASSIGNED --> IN_PROGRESS: staff starts
    IN_PROGRESS --> RESOLVED: staff resolves
    RESOLVED --> CLOSED: citizen gives feedback
    RESOLVED --> IN_PROGRESS: citizen reopens
    SUBMITTED --> REJECTED: admin rejects
    ASSIGNED --> REJECTED: admin rejects
    IN_PROGRESS --> REJECTED: admin rejects
    CLOSED --> [*]
    REJECTED --> [*]
    CANCELLED --> [*]
```

A status change that is not in this diagram is refused with `409`. When a paid request is rejected or cancelled, the fee is refunded through Stripe.

## Deadline Escalation

```mermaid
sequenceDiagram
    participant Cron as Vercel Cron (daily)
    participant API
    participant DB as PostgreSQL
    Cron->>API: GET /jobs/sla-check (Bearer CRON_SECRET)
    API->>DB: open complaints past their due date, not yet escalated
    loop each complaint, in its own transaction
        API->>DB: lock the row, raise the priority, set escalatedAt
        API->>DB: timeline note, audit log, notifications to admins and staff
    end
    API->>DB: remove read notifications older than 90 days
    API-->>Cron: checked, escalated, failed, pruned
```

Admins run the same check with `POST /admin/sla-check`. The job endpoint compares the secret in constant time and answers `503` when no secret is configured.

## Payment Flow

1. The citizen creates a service request. Its status is `PENDING_PAYMENT`
2. `POST /payments/initiate` creates a Stripe Checkout session and returns `checkoutUrl`
3. The citizen pays on the Stripe page
4. Stripe sends the citizen to `GET /payments/success?session_id=...`. The server asks Stripe if the session is really paid, and only then completes the payment. If the citizen leaves the Stripe page, Stripe sends them to `GET /payments/cancel`
5. Stripe also calls `POST /payments/webhook`. The signature is verified. So the payment is saved even if the citizen closes the browser
6. The payment becomes `COMPLETED`, the request becomes `SUBMITTED` and the deadline starts
7. `GET /payments` and `GET /payments/:id` show the status

A frontend can send `clientUrl` to `POST /payments/initiate`. Then Stripe sends the user back to the frontend, and the frontend calls `POST /payments/verify`.

## API Response Format

Success:

```json
{
    "success": true,
    "message": "Complaints retrieved successfully",
    "meta": { "page": 1, "limit": 10, "total": 25, "totalPages": 3 },
    "data": []
}
```

Error:

```json
{
    "success": false,
    "message": "Validation failed",
    "errors": [{ "field": "email", "message": "A valid email is required" }]
}
```

Protected routes need the header `Authorization: Bearer <accessToken>`. Every response has an `X-Request-Id` header. A client may send its own id in the same header.

## API Endpoints

Base URL: `/api/v1`

The API has 77 endpoints.

### Auth

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Register a citizen account |
| POST | `/auth/login` | Public | Login with email and password |
| POST | `/auth/refresh-token` | Public | Get a new access token |
| POST | `/auth/logout` | Public | Logout and revoke the refresh token |
| POST | `/auth/change-password` | Any logged in user | Change own password |
| POST | `/auth/forgot-password` | Public | Send a password reset email |
| POST | `/auth/reset-password` | Public | Set a new password with the reset token |
| GET | `/auth/google` | Public | Start the Google login |
| GET | `/auth/google/callback` | Public | Google sends the user back here |
| POST | `/auth/google` | Public | Login with a Google ID token |
| POST | `/auth/google/exchange` | Public | Exchange the one time Google login code for tokens |

### Users

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/users/me` | Any logged in user | Get own profile |
| PATCH | `/users/me` | Any logged in user | Update own profile |

### Departments

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/departments` | Public | Get all departments |
| GET | `/departments/:id` | Public | Get one department with its categories |
| POST | `/departments` | Admin | Create a department |
| PATCH | `/departments/:id` | Admin | Update a department |
| DELETE | `/departments/:id` | Admin | Remove a department (soft delete) |

### Categories

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/categories` | Public | Get complaint and service categories |
| GET | `/categories/:id` | Public | Get one category |
| POST | `/categories` | Admin | Create a category |
| PATCH | `/categories/:id` | Admin | Update a category |
| DELETE | `/categories/:id` | Admin | Remove a category (soft delete) |

### Complaints

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| POST | `/complaints` | Citizen | Submit a complaint or a service request |
| GET | `/complaints` | Any logged in user | List complaints with search, filters, sorting and pagination |
| GET | `/complaints/track/:trackingCode` | Public | Track a complaint with its tracking code |
| GET | `/complaints/map` | Any logged in user | Get complaints that have a location, for a map |
| GET | `/complaints/:id` | Any logged in user | Get complaint details with the timeline |
| PATCH | `/complaints/:id` | Citizen or Admin | Update a complaint |
| DELETE | `/complaints/:id` | Citizen or Admin | Remove a complaint (soft delete) |
| POST | `/complaints/:id/assign` | Admin | Assign a complaint to a staff member |
| PATCH | `/complaints/:id/status` | Staff or Admin | Change the status of a complaint |
| POST | `/complaints/:id/cancel` | Citizen | Cancel own complaint before it is assigned |
| POST | `/complaints/:id/reopen` | Citizen | Reopen a resolved complaint |
| POST | `/complaints/:id/transfer` | Admin | Transfer a complaint to another department |
| POST | `/complaints/:id/feedback` | Citizen | Give feedback on a resolved complaint |
| POST | `/complaints/:id/attachments` | Any logged in user | Upload images to a complaint |
| DELETE | `/complaints/:id/attachments/:attachmentId` | Any logged in user | Remove an image from a complaint |
| GET | `/complaints/:id/comments` | Any logged in user | Get the messages on a complaint |
| POST | `/complaints/:id/comments` | Any logged in user | Send a message or an internal note on a complaint |
| DELETE | `/complaints/:id/comments/:commentId` | Any logged in user | Remove a message |

### Community

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/complaints/public` | Public | List public reports for the city map |
| GET | `/complaints/nearby` | Any logged in user | Find open public reports near a spot |
| POST | `/complaints/:id/support` | Citizen | Support a public report that affects you too |
| DELETE | `/complaints/:id/support` | Citizen | Withdraw your support |

### Notifications

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/notifications` | Any logged in user | List own notifications, newest first |
| GET | `/notifications/unread-count` | Any logged in user | Count own unread notifications |
| PATCH | `/notifications/read-all` | Any logged in user | Mark all own notifications as read |
| PATCH | `/notifications/:id/read` | Any logged in user | Mark one notification as read |

### Payments

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| POST | `/payments/initiate` | Citizen | Create a Stripe Checkout session for a service request |
| GET | `/payments/success` | Public | Stripe sends the user here after a successful payment |
| GET | `/payments/cancel` | Public | Stripe sends the user here when the checkout is cancelled |
| POST | `/payments/verify` | Citizen | Verify a checkout session with Stripe |
| POST | `/payments/webhook` | Stripe | Stripe webhook |
| GET | `/payments` | Citizen or Admin | Get the payment history |
| GET | `/payments/:id` | Citizen or Admin | Get one payment |
| POST | `/payments/:id/refund` | Admin | Refund a payment of a rejected or cancelled request |

### Stats

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/stats/public` | Public | Get public statistics |
| GET | `/stats/me` | Any logged in user | Get the numbers for the dashboard of the logged in user |

### Contact

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| POST | `/contact` | Public | Send a message to the city team |

### Admin

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/admin/users` | Admin | Get all users with search, filters and pagination |
| POST | `/admin/users` | Admin | Create a staff or admin account |
| PATCH | `/admin/users/:id/role` | Admin | Change the role of a user |
| PATCH | `/admin/users/:id/status` | Admin | Block or unblock a user |
| DELETE | `/admin/users/:id` | Admin | Remove a user (soft delete) |
| GET | `/admin/staff-workload` | Admin | Get the staff members with their active complaints |
| GET | `/admin/dashboard-stats` | Admin | Get the platform statistics |
| GET | `/admin/audit-logs` | Admin | Get the audit logs |
| GET | `/admin/exports/complaints` | Admin | Download complaints as a CSV file |
| GET | `/admin/exports/payments` | Admin | Download payments as a CSV file |
| POST | `/admin/sla-check` | Admin | Run the deadline check now |
| GET | `/admin/messages` | Admin | Get the contact messages |
| POST | `/admin/messages/:id/reply` | Admin | Reply to a contact message by email |
| PATCH | `/admin/messages/:id/status` | Admin | Close or reopen a contact message |

### System

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| GET | `/health/live` | Public | Check that the API process is running |
| GET | `/health` | Public | Check the API, the database and redis |
| GET | `/jobs/sla-check` | Scheduler | Escalate complaints that missed their deadline |

The public map feed and the tracking endpoint also accept an access token. With it, each report says if it belongs to you (`isMine`) and if you support it (`supportedByMe`).

## Security

- Passwords are hashed with bcrypt. Refresh tokens and reset tokens are stored as SHA-256 hashes
- Access tokens are short lived JWTs. Refresh tokens are rotated on every use. Parallel requests may use the same token for a few seconds, after that a reused token revokes the session
- helmet security headers, a CORS allow list and a JSON body size limit
- Rate limiting on every route and a stricter limit on the auth routes
- Zod validation on every body, query and path parameter
- The Stripe webhook signature is verified. Uploaded files are checked by their real content, not only by the file name
- Internal notes, private reports and personal data never leave the API for people who should not see them. Integration tests check each of these rules
- CSV cells that start with `=`, `+`, `-`, `@`, a tab or a carriage return are neutralised, so an export cannot run a formula in a spreadsheet

## Testing

| Suite | Files | What it covers |
| --- | --- | --- |
| Unit | 9 | Validation schemas, tokens, CSV writing, distances, client IP, upload checks, the error handler and helpers |
| Integration | 23 | The real Express app against PostgreSQL and Redis: auth and Google login, the full workflow, assignment races, payments with the Stripe webhook, refunds, photos, messages, community, notifications, the deadline job, exports, caching, rate limits, emails and the API docs |

464 tests in total. Stripe, Cloudinary, Google and email are replaced by fakes, so the tests never call a real service and never need real keys.

```bash
bun run test                  # every test
bun run test:unit             # unit tests only
bun run test:integration      # needs TEST_DATABASE_URL and TEST_REDIS_URL
bun run test:coverage         # with a coverage report
```

The integration tests create their database and apply the migrations by themselves. Without `TEST_DATABASE_URL` they use `postgresql://postgres:postgres@localhost:5433/citycare_test`.

### Continuous integration

Every push and pull request runs three jobs in GitHub Actions:

1. **Quality**: Biome, the TypeScript check and the unit tests.
2. **Integration**: starts PostgreSQL and Redis, runs every test with coverage and checks that the migrations match the Prisma schema.
3. **Build**: the tsup bundle and the Docker image.

## Run It With Docker

You only need Docker.

```bash
git clone https://github.com/ebrahim2355/citycare-backend.git
cd citycare-backend
docker compose up -d --build
```

This starts PostgreSQL, Redis, [Mailpit](https://mailpit.axllent.org) and the API. A one-off container applies the migrations and seeds the demo data first.

| Service | Address |
| --- | --- |
| API | http://localhost:5000/api/v1 |
| Swagger | http://localhost:5000/api/v1/docs |
| Mailpit (every email the API sends) | http://localhost:8025 |
| PostgreSQL | localhost:5433 |
| Redis | localhost:6380 |

Change the ports with `API_PORT`, `DB_PORT`, `REDIS_PORT` and `MAILPIT_PORT`. Add your Stripe, Google or Cloudinary keys to the environment to turn those features on. The compose network is called `citycare`, so the [frontend](https://github.com/ebrahim2355/citycare-frontend) can join it with its own `docker compose up`.

## Run It Locally

You need Bun, Node.js 24 and a PostgreSQL database. Redis is optional.

```bash
git clone https://github.com/ebrahim2355/citycare-backend.git
cd citycare-backend
bun install
```

Create a `.env` file from `.env.example` and set at least `DATABASE_URL` and `JWT_ACCESS_SECRET`.

```bash
bunx prisma generate
bunx prisma migrate deploy
bun run seed
bun run dev
```

The API runs on http://localhost:5000 and the docs are on http://localhost:5000/api/v1/docs.

### Scripts

| Script | What it does |
| --- | --- |
| `bun run dev` | Starts the dev server with reload |
| `bun run build` | Bundles the project with tsup into `dist` |
| `bun run start` | Runs the built server |
| `bun run seed` | Adds the admin, the departments, the categories and the demo data |
| `bun run migrate` | Creates and applies a migration in development |
| `bun run migrate:deploy` | Applies the migrations in production |
| `bun run typecheck` | Checks the types |
| `bun run lint` | Runs Biome |
| `bun run test` | Runs the unit and integration tests |
| `bun run docs:postman` | Writes the Postman collection from the API documentation |

### Environment Variables

| Variable | Needed | Description |
| --- | --- | --- |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | Yes | A random string of at least 32 characters |
| `APP_URL` | In production | Public URL of this API. Used for the Google and Stripe callbacks |
| `REDIS_URL` | No | Redis for the cache and the rate limit. Without it the cache is off and the limit is kept in memory |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | For payments | Stripe test keys |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | For Google login | OAuth client from the Google Cloud console |
| `EMAIL_USER`, `GOOGLE_APP_PASSWORD` | For emails | Gmail address and its app password. `SMTP_HOST` and `SMTP_PORT` point to another mail server |
| `EMAIL_SKIP_DOMAINS` | No | Domains that never get an email. Set it to `citycare.com` so the demo accounts do not send mail to a real domain |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | For photo upload | Cloudinary keys |
| `CLIENT_URL`, `CORS_ORIGINS` | No | Frontend URL and the allowed origins |
| `INTERNAL_API_KEY` | With a frontend server | Shared with the frontend server. When a request has this key in `x-internal-key`, the API uses `x-client-ip` for the rate limit and the logs, because every request of a server side frontend comes from the same IP |
| `CRON_SECRET` | For the deadline job | The scheduler sends it as a bearer token to `/api/v1/jobs/sla-check`. Without it the job answers `503` |
| `LOG_LEVEL` | No | `fatal`, `error`, `warn`, `info` (default), `debug`, `trace` or `silent` |

The other variables in `.env.example` have good default values. A feature that has no keys answers with `503` and a clear message. The rest of the API keeps working.

## Deployment on Vercel

```bash
bun run build
vercel --prod
```

`vercel.json` sends every request to `dist/server.js` and runs the deadline check every day at 02:00 UTC with Vercel Cron. Set the environment variables in the Vercel project (including `CRON_SECRET`, which Vercel sends with every cron call), then run the migrations and the seed against the production database:

```bash
bunx prisma migrate deploy
bun run seed
```

After the deploy:

- Stripe: add a webhook for `<APP_URL>/api/v1/payments/webhook` with the events `checkout.session.completed`, `checkout.session.expired` and `charge.refunded`
- Google: add `<APP_URL>/api/v1/auth/google/callback` as an authorized redirect URI of the OAuth client

The API follows the serverless rules: no WebSockets, no files on the local disk and no state in memory. Shared state is in PostgreSQL and Redis, and the only background work is the scheduled job.

The same API also ships as a container. The Dockerfile installs and builds with Bun, then runs the bundle on Node.js Alpine as a non-root user with a health check.
