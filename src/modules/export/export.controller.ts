import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import prisma from "../../lib/prisma";
import { currentUser } from "../../middlewares/auth";
import { recordAudit } from "../../utils/auditLog";
import catchAsync from "../../utils/catchAsync";
import { CSV_BOM } from "../../utils/csv";
import { getRequestContext } from "../../utils/requestContext";
import { AuditAction, AuditEntity, type TAuditEntity } from "../audit/audit.constant";
import { ExportService } from "./export.service";

const streamCsv = async (req: Request, res: Response, name: string, entity: TAuditEntity, lines: AsyncGenerator<string>) => {
    const header = await lines.next();
    const filename = `citycare-${name}-${new Date().toISOString().slice(0, 10)}.csv`;
    let rows = 0;

    res.status(StatusCodes.OK);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.write(`${CSV_BOM}${header.value ?? ""}`);

    try {
        for await (const line of lines) {
            res.write(line);
            rows++;
        }
    } catch (error) {
        res.destroy(error instanceof Error ? error : new Error("Export failed"));
        return;
    }

    await recordAudit(prisma, {
        actorId: currentUser(req).id,
        action: AuditAction.DATA_EXPORTED,
        entityType: entity,
        metadata: { format: "csv", rows, filters: res.locals.query ?? {} },
        ipAddress: getRequestContext(req).ipAddress,
    }).catch((error: unknown) => {
        req.log.error({ err: error }, "Could not write the export to the audit log");
    });

    res.end();
};

const exportComplaints = catchAsync(async (req, res) => {
    await streamCsv(req, res, "complaints", AuditEntity.COMPLAINT, ExportService.complaintLines(currentUser(req), res.locals.query));
});

const exportPayments = catchAsync(async (req, res) => {
    await streamCsv(req, res, "payments", AuditEntity.PAYMENT, ExportService.paymentLines(res.locals.query));
});

export const ExportController = {
    exportComplaints,
    exportPayments,
};
