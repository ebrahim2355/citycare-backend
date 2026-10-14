import cors from "cors";
import express, { type Application, type Request, type Response } from "express";
import helmet from "helmet";
import morgan from "morgan";
import config from "./config";
import globalErrorHandler from "./middlewares/globalErrorHandler";
import notFound from "./middlewares/notFound";
import { apiLimiter } from "./middlewares/rateLimiter";
import saveRawBody from "./middlewares/rawBody";
import router from "./routes";

const app: Application = express();

app.set("trust proxy", 1);

app.use(helmet());
app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || !config.clientOrigins.length || config.clientOrigins.includes(origin)) {
                callback(null, true);
                return;
            }

            callback(null, false);
        },
        credentials: true,
        exposedHeaders: ["X-Cache", "RateLimit", "RateLimit-Policy", "Retry-After"],
    })
);
app.use(morgan(config.isProduction ? "combined" : "dev"));
app.use(express.json({ limit: "1mb", verify: saveRawBody }));
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: "CityCare API is running",
        data: {
            version: "v1",
            baseUrl: "/api/v1",
            docs: "/api/v1/docs",
            health: "/api/v1/health",
        },
    });
});

app.use("/api/v1", apiLimiter, router);

app.use(notFound);
app.use(globalErrorHandler);

export default app;
