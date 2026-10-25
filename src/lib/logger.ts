import pino from "pino";
import config from "../config";

const logger = pino({
    level: config.logLevel,
    base: { service: "citycare-api" },
    timestamp: pino.stdTimeFunctions.isoTime,
    ...(config.prettyLogs
        ? {
              transport: {
                  target: "pino-pretty",
                  options: {
                      colorize: true,
                      singleLine: true,
                      translateTime: "SYS:HH:MM:ss",
                      ignore: "pid,hostname,service,req,res,responseTime",
                  },
              },
          }
        : {}),
});

export default logger;
