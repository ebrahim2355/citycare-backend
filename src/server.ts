import app from "./app";
import config from "./config";

if (!process.env.VERCEL) {
    app.listen(config.port, () => {
        console.log(`CityCare server is running on port ${config.port}`);
    });
}

export default app;
