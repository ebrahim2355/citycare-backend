import { defineConfig } from "vitest/config";
import { integrationEnv, unitEnv } from "./tests/setup/env.ts";

export default defineConfig({
    test: {
        coverage: {
            provider: "v8",
            include: ["src/**/*.ts"],
            exclude: ["src/generated/**", "src/server.ts", "src/docs/swagger.ts"],
            reporter: ["text-summary", "html", "lcov"],
        },
        projects: [
            {
                test: {
                    name: "unit",
                    include: ["tests/unit/**/*.test.ts"],
                    env: unitEnv,
                },
            },
            {
                test: {
                    name: "integration",
                    include: ["tests/integration/**/*.test.ts"],
                    env: integrationEnv,
                    globalSetup: ["tests/setup/global-setup.ts"],
                    setupFiles: ["tests/setup/integration.ts"],
                    fileParallelism: false,
                    testTimeout: 30000,
                    hookTimeout: 60000,
                },
            },
        ],
    },
});
