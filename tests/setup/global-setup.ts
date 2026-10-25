import { execFileSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { integrationEnv } from "./env";

const ensureDatabase = async (databaseUrl: string) => {
    const url = new URL(databaseUrl);
    const database = decodeURIComponent(url.pathname.slice(1));
    const maintenanceUrl = new URL(databaseUrl);

    maintenanceUrl.pathname = "/postgres";
    maintenanceUrl.search = "";

    const client = new pg.Client({ connectionString: maintenanceUrl.toString() });

    await client.connect();

    try {
        const found = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [database]);

        if (!found.rowCount) {
            await client.query(`CREATE DATABASE "${database.replace(/"/g, '""')}"`);
        }
    } finally {
        await client.end();
    }
};

export default async function setup() {
    await ensureDatabase(integrationEnv.DATABASE_URL);

    execFileSync(process.execPath, [path.resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"], {
        env: { ...process.env, ...integrationEnv },
        stdio: "pipe",
    });
}
