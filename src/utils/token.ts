import { createHash, randomBytes } from "node:crypto";

export const generateToken = (bytes = 40) => randomBytes(bytes).toString("hex");

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
