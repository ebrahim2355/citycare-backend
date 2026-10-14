import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.join(process.cwd(), ".env"), quiet: true });

const envSchema = z.object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    APP_URL: z.url().optional(),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    JWT_ACCESS_SECRET: z.string("JWT_ACCESS_SECRET is required").min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
    JWT_ACCESS_EXPIRES_IN: z.string().default("1h"),
    REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(30),
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(8).max(14).default(10),
    MAX_ACTIVE_ASSIGNMENTS: z.coerce.number().int().positive().default(5),
    REOPEN_WINDOW_DAYS: z.coerce.number().int().positive().default(7),
    MAX_REOPENS: z.coerce.number().int().min(0).default(2),
    REDIS_URL: z.string().default(""),
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    EMAIL_USER: z.string().default(""),
    GOOGLE_APP_PASSWORD: z.string().default(""),
    EMAIL_FROM: z.string().default(""),
    SMTP_HOST: z.string().default(""),
    SMTP_PORT: z.coerce.number().int().positive().default(587),
    RESET_TOKEN_MINUTES: z.coerce.number().int().positive().default(30),
    ADMIN_EMAIL: z.email().default("admin@citycare.com"),
    ADMIN_PASSWORD: z.string().min(8, "ADMIN_PASSWORD must be at least 8 characters").default("Admin12345"),
    CLOUDINARY_URL: z.string().default(""),
    CLOUDINARY_CLOUD_NAME: z.string().default(""),
    CLOUDINARY_API_KEY: z.string().default(""),
    CLOUDINARY_API_SECRET: z.string().default(""),
    STRIPE_SECRET_KEY: z.string().default(""),
    STRIPE_WEBHOOK_SECRET: z.string().default(""),
    PAYMENT_CURRENCY: z.string().length(3, "PAYMENT_CURRENCY must be a 3 letter code").default("usd"),
    CLIENT_URL: z.url().optional(),
    CORS_ORIGINS: z.string().default(""),
    RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().positive().default(15),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");

    throw new Error(`Invalid environment variables. ${problems}`);
}

const env = parsed.data;
const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL;
const cleanUrl = (url: string) => url.trim().replace(/\/$/, "");
const clientUrl = env.CLIENT_URL ? cleanUrl(env.CLIENT_URL) : null;
const corsOrigins = env.CORS_ORIGINS.split(",").map(cleanUrl).filter(Boolean);
const appUrl = cleanUrl(env.APP_URL ?? (vercelUrl ? `https://${vercelUrl}` : `http://localhost:${env.PORT}`));

const config = {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    jwt: {
        accessSecret: env.JWT_ACCESS_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    },
    refreshTokenDays: env.REFRESH_TOKEN_DAYS,
    saltRounds: env.BCRYPT_SALT_ROUNDS,
    complaint: {
        maxActiveAssignments: env.MAX_ACTIVE_ASSIGNMENTS,
        reopenWindowDays: env.REOPEN_WINDOW_DAYS,
        maxReopens: env.MAX_REOPENS,
    },
    stripe: {
        secretKey: env.STRIPE_SECRET_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        currency: env.PAYMENT_CURRENCY.toLowerCase(),
    },
    email: {
        user: env.EMAIL_USER,
        password: env.GOOGLE_APP_PASSWORD.replace(/\s/g, ""),
        from: env.EMAIL_FROM || (env.EMAIL_USER ? `CityCare <${env.EMAIL_USER}>` : "CityCare <no-reply@citycare.local>"),
        smtpHost: env.SMTP_HOST,
        smtpPort: env.SMTP_PORT,
    },
    resetTokenMinutes: env.RESET_TOKEN_MINUTES,
    admin: {
        email: env.ADMIN_EMAIL.toLowerCase(),
        password: env.ADMIN_PASSWORD,
    },
    cloudinary: {
        url: env.CLOUDINARY_URL,
        cloudName: env.CLOUDINARY_CLOUD_NAME,
        apiKey: env.CLOUDINARY_API_KEY,
        apiSecret: env.CLOUDINARY_API_SECRET,
    },
    google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: `${appUrl}/api/v1/auth/google/callback`,
    },
    clientUrl,
    corsOrigins,
    clientOrigins: [...new Set([...(clientUrl ? [clientUrl] : []), ...corsOrigins])],
    rateLimit: {
        windowMinutes: env.RATE_LIMIT_WINDOW_MINUTES,
        max: env.RATE_LIMIT_MAX,
        authMax: env.AUTH_RATE_LIMIT_MAX,
    },
    appUrl,
};

export default config;
