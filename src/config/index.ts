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
    BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(8).max(14).default(10),
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

const config = {
    nodeEnv: env.NODE_ENV,
    isProduction: env.NODE_ENV === "production",
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    jwt: {
        accessSecret: env.JWT_ACCESS_SECRET,
        accessExpiresIn: env.JWT_ACCESS_EXPIRES_IN,
    },
    saltRounds: env.BCRYPT_SALT_ROUNDS,
    corsOrigins: env.CORS_ORIGINS.split(",")
        .map((origin) => origin.trim().replace(/\/$/, ""))
        .filter(Boolean),
    rateLimit: {
        windowMinutes: env.RATE_LIMIT_WINDOW_MINUTES,
        max: env.RATE_LIMIT_MAX,
        authMax: env.AUTH_RATE_LIMIT_MAX,
    },
    appUrl: (env.APP_URL ?? (vercelUrl ? `https://${vercelUrl}` : `http://localhost:${env.PORT}`)).replace(/\/$/, ""),
};

export default config;
