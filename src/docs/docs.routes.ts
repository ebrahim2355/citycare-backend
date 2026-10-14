import { Router } from "express";
import { swaggerDocument, swaggerHtml } from "./swagger";

const router = Router();

const docsContentPolicy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
].join("; ");

router.get("/", (_req, res) => {
    res.setHeader("Content-Security-Policy", docsContentPolicy);
    res.type("html").send(swaggerHtml);
});

router.get("/openapi.json", (_req, res) => {
    res.json(swaggerDocument);
});

export const DocsRoutes = router;
