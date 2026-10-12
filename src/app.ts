import express, { type Application, type Request, type Response } from "express";

const app: Application = express();

app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
    res.status(200).json({
        success: true,
        message: "CityCare API is running",
        data: {
            version: "v1",
        },
    });
});

export default app;
