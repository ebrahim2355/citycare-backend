const FORMULA_START = /^[=+\-@\t\r]/;
const NEEDS_QUOTES = /[",\r\n]|^\s|\s$/;

export const csvCell = (value: unknown) => {
    if (value === null || value === undefined) {
        return "";
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return String(value);
    }

    const raw = value instanceof Date ? value.toISOString() : String(value);
    const text = FORMULA_START.test(raw) ? `'${raw}` : raw;

    return NEEDS_QUOTES.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const csvRow = (values: unknown[]) => `${values.map(csvCell).join(",")}\r\n`;

export const CSV_BOM = "﻿";
