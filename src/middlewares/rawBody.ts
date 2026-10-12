import type { IncomingMessage, ServerResponse } from "node:http";

declare global {
    namespace Express {
        interface Request {
            rawBody?: Buffer;
        }
    }
}

const saveRawBody = (req: IncomingMessage & { rawBody?: Buffer }, _res: ServerResponse, buffer: Buffer) => {
    req.rawBody = buffer;
};

export default saveRawBody;
