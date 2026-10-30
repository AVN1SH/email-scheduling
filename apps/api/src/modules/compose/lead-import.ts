import { parse } from "csv-parse/sync";
import { z } from "zod";
import {
  MAX_LEAD_FILE_BYTES,
  MAX_RECIPIENTS,
  type LeadImportResult,
} from "@repo/shared";
import { AppError } from "../../errors/app-error.js";

export function parseLeads(
  filename: string,
  content: string,
): LeadImportResult {
  if (
    Buffer.byteLength(content) > MAX_LEAD_FILE_BYTES ||
    content.includes("\0")
  )
    throw new AppError(
      400,
      "INVALID_LEAD_FILE",
      "Use a UTF-8 CSV/text file up to 1 MB.",
    );
  let candidates: string[];
  if (/\.csv$/i.test(filename)) {
    let rows: string[][];
    try {
      rows = parse(content, {
        bom: true,
        skip_empty_lines: true,
        trim: true,
        relax_column_count: true,
        max_record_size: 10000,
      }) as string[][];
    } catch {
      throw new AppError(
        400,
        "INVALID_CSV",
        "Check the CSV quoting and row format.",
      );
    }
    const header = rows[0] ?? [];
    const column = header.findIndex((cell) =>
      /^(e-?mail(?:[ _-]?address)?)$/i.test(cell.trim()),
    );
    candidates =
      column >= 0
        ? rows.slice(1).map((row) => row[column] ?? "")
        : rows.flatMap((row) =>
            row.length === 1 ? row : row.filter((cell) => cell.includes("@")),
          );
  } else candidates = content.replace(/^\uFEFF/, "").split(/[\s,;]+/);
  if (candidates.length > 10000)
    throw new AppError(
      400,
      "TOO_MANY_LEADS",
      "Import at most 10,000 entries and 5,000 unique addresses at a time.",
    );
  const recipients = new Set<string>(),
    invalid: string[] = [];
  let duplicateCount = 0,
    detectedCount = 0;
  for (const raw of candidates) {
    const value = raw.trim().toLowerCase();
    if (!value) continue;
    if (!z.email().max(254).safeParse(value).success) {
      invalid.push(raw.slice(0, 320));
      continue;
    }
    detectedCount++;
    if (recipients.has(value)) duplicateCount++;
    else recipients.add(value);
  }
  if (recipients.size > MAX_RECIPIENTS)
    throw new AppError(
      400,
      "TOO_MANY_RECIPIENTS",
      "Use at most 5,000 unique recipients.",
    );
  return {
    recipients: [...recipients],
    invalid: invalid.slice(0, 100),
    invalidCount: invalid.length,
    duplicateCount,
    detectedCount,
  };
}
