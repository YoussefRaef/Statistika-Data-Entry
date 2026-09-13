import * as XLSX from "xlsx";
import { norm } from "./names.js";

// Turns any date-ish cell value (JS Date, "1.9.2026", "2026-09-01", ...)
// into a normalized "YYYY-MM-DD" string for comparison.
export function parseAnyDate(val) {
  if (val instanceof Date) {
    const y = val.getUTCFullYear();
    const m = String(val.getUTCMonth() + 1).padStart(2, "0");
    const d = String(val.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof val === "string") {
    const s = val.trim();
    let m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s); // d.m.yyyy
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); // yyyy-mm-dd
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); // d/m/yyyy
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function cleanHeader(h) {
  return String(h ?? "").replace(/\r?\n/g, " ").trim();
}

/**
 * Reads the 'Detaily tras' sheet from a daily-route file ArrayBuffer.
 * Uses SheetJS (not ExcelJS) because it can read BOTH the old binary
 * .xls format and .xlsx - ExcelJS only supports .xlsx.
 *
 * Returns: { targetDate: "YYYY-MM-DD"|null, ordersByName: Map<normName, [{order, arrival}]> }
 */
export function loadDailyRoutes(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array", cellDates: true });

  const sheetName = wb.SheetNames.find((n) => n.trim() === "Detaily tras");
  if (!sheetName) {
    throw new Error(
      `Sheet 'Detaily tras' not found in the daily route file. Sheets found: ${wb.SheetNames.join(", ")}`
    );
  }
  const sheet = wb.Sheets[sheetName];

  // Get everything as an array-of-arrays so we can find columns by header
  // text ourselves (same approach as the Python/ExcelJS version).
  const grid = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  if (grid.length === 0) {
    throw new Error("'Detaily tras' sheet appears to be empty.");
  }

  const headerRow = grid[0].map(cleanHeader);
  const colIndex = {};
  headerRow.forEach((h, i) => {
    if (h) colIndex[h] = i;
  });

  const nameCol = colIndex["Jméno řidiče"];
  const dateCol = colIndex["Datum"];
  const arrivalCol = colIndex["Příjezd"];
  const orderCol = colIndex["Objednávka"];

  if (nameCol === undefined || dateCol === undefined || orderCol === undefined) {
    throw new Error(
      "Could not find expected columns ('Jméno řidiče', 'Datum', 'Objednávka') in 'Detaily tras'. " +
        `Headers found: ${headerRow.filter(Boolean).join(", ")}`
    );
  }

  const rows = [];
  const dateCounts = new Map();

  for (let r = 1; r < grid.length; r++) {
    const line = grid[r];
    if (!line) continue;
    const nameVal = line[nameCol];
    if (!nameVal) continue;

    const dateVal = line[dateCol];
    const dateStr = parseAnyDate(dateVal);
    if (dateStr) dateCounts.set(dateStr, (dateCounts.get(dateStr) || 0) + 1);

    let orderVal = orderCol !== undefined ? line[orderCol] : null;
    if (typeof orderVal === "number" && Number.isInteger(orderVal)) {
      orderVal = String(orderVal);
    } else if (orderVal != null && orderVal !== "") {
      orderVal = String(orderVal);
    } else {
      orderVal = null;
    }

    const arrivalVal = arrivalCol !== undefined ? line[arrivalCol] : null;

    rows.push({
      name: String(nameVal).trim(),
      dateStr,
      order: orderVal,
      arrival: arrivalVal,
    });
  }

  let targetDate = null;
  if (dateCounts.size === 1) {
    targetDate = [...dateCounts.keys()][0];
  } else if (dateCounts.size > 1) {
    targetDate = [...dateCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  const ordersByName = new Map();
  for (const r of rows) {
    if (r.dateStr !== targetDate) continue;
    const key = norm(r.name);
    if (!ordersByName.has(key)) ordersByName.set(key, []);
    ordersByName.get(key).push(r);
  }
  for (const arr of ordersByName.values()) {
    arr.sort((a, b) => {
      const av = a.arrival instanceof Date ? a.arrival.getTime() : typeof a.arrival === "number" ? a.arrival : 0;
      const bv = b.arrival instanceof Date ? b.arrival.getTime() : typeof b.arrival === "number" ? b.arrival : 0;
      return av - bv;
    });
  }

  return { targetDate, ordersByName, dateCounts };
}

/** Returns the list of order numbers (string|null) for a canonical name. */
export function getOrders(ordersByName, canonicalName) {
  const key = norm(canonicalName);
  const rows = ordersByName.get(key);
  if (!rows) return [];
  return rows.map((r) => r.order);
}