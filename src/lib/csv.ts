// CSV for the analytics exports, shaped for spreadsheets: a byte-order mark so Excel reads UTF-8 (names with accents,
// the en dash in age ranges), CRLF line ends, and cells that would start a formula prefixed with a quote, so a
// listener named "=HYPERLINK(…)" stays text.
export type CsvCell = string | number | boolean | null | undefined;

const formulaStart = /^[=+\-@\t\r]/;

const csvCell = (value: CsvCell) => {
	if (value === null || value === undefined) return '';
	let text = String(value);
	if (typeof value === 'string' && formulaStart.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsv = (headers: string[], rows: CsvCell[][]) =>
	`﻿${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;

/** A file name like `oz-listeners-2026-11-09.csv`. */
export const csvFileName = (name: string, date = new Date()) => `oz-${name}-${date.toISOString().slice(0, 10)}.csv`;
