import ExcelJS from "exceljs";
import { parseEmail } from "./parseEmail.js";
import { matchCanonical, isTechnician } from "./names.js";
import { loadDailyRoutes, getOrders, parseAnyDate } from "./dailyRoutes.js";

function buildHeaderMap(ws) {
  const header = {};
  ws.getRow(1).eachCell((cell, col) => {
    if (cell.value) header[String(cell.value).trim()] = col;
  });
  return header;
}

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : undefined;
}

/** Copies an entire row (values + styles) from srcRowNum to dstRowNum. */
function copyRow(ws, srcRowNum, dstRowNum, lastCol) {
  const srcRow = ws.getRow(srcRowNum);
  const dstRow = ws.getRow(dstRowNum);
  for (let c = 1; c <= lastCol; c++) {
    const srcCell = srcRow.getCell(c);
    const dstCell = dstRow.getCell(c);
    dstCell.value = srcCell.value;
    dstCell.style = cloneStyle(srcCell.style);
  }
  if (srcRow.height) dstRow.height = srcRow.height;
}

/**
 * Finds n_needed free template rows for targetDate on this sheet (rows
 * where DATUM matches and SPZ vozidla is blank). If the sheet runs out of
 * already-dated rows, it extends by cloning the row immediately above
 * (styles + values, e.g. REGION/POBOČKA/colors) and stamping in the
 * correct DATUM - this is what fixes the "ran out of rows" bug.
 */
/** Builds a proper Excel-friendly Date object (UTC midnight) from a "YYYY-MM-DD" string. */
function dateStringToDateObj(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function findOrCreateRows(ws, header, targetDate, nNeeded) {
  const colDate = header["DATUM"];
  const colSpz = header["SPZ vozidla"];
  const lastCol = ws.columnCount;

  const rows = [];
  let lastRowSeen = 1;
  const dateValue = dateStringToDateObj(targetDate);

  // A row is available if SPZ is blank AND its DATUM either already
  // matches this date, or is blank (some templates pre-fill REGION/
  // POBOČKA for the whole month but leave DATUM blank until a day's
  // data actually claims that row - in that case we stamp our own date
  // into it and keep its existing REGION/POBOČKA).
  for (let r = 2; r <= ws.rowCount; r++) {
    lastRowSeen = r;
    const spzVal = ws.getRow(r).getCell(colSpz).value;
    if (spzVal) continue;

    const dCell = ws.getRow(r).getCell(colDate).value;
    const dStr = parseAnyDate(dCell);
    if (dStr === targetDate || !dStr) {
      if (!dStr) {
        ws.getRow(r).getCell(colDate).value = dateValue;
      }
      rows.push(r);
      if (rows.length === nNeeded) return { rows, lastCol, extended: false };
    }
  }

  // Ran out of usable rows entirely (no pre-dated AND no blank rows left)
  // - extend past the very end of the sheet, cloning the last row's
  // style/values (REGION/POBOČKA etc.) and stamping in the correct date.
  let insertAfter = lastRowSeen;
  let extended = false;
  while (rows.length < nNeeded) {
    insertAfter += 1;
    extended = true;
    copyRow(ws, insertAfter - 1, insertAfter, lastCol);
    ws.getRow(insertAfter).getCell(colDate).value = dateValue;
    rows.push(insertAfter);
  }
  return { rows, lastCol, extended };
}


/**
 * ExcelJS shares style objects across cells that look identical (to keep
 * file size down) - reading cell.style can hand back the SAME object
 * reference used by many other cells. Mutating a cell's border/alignment
 * directly can silently change every other cell sharing that reference.
 * This forces the cell to own an independent copy of its style before we
 * touch anything on it.
 */
function ensureOwnStyle(cell) {
  cell.style = JSON.parse(JSON.stringify(cell.style || {}));
}

function writeEntry(ws, header, rows, spz, driver, helper, fakturaValues) {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const row = ws.getRow(r);

    // force the DATUM display format to match the daily file's Czech
    // style (d.m.yyyy) instead of whatever locale-dependent format the
    // template cell happened to carry.
    const dateCell = row.getCell(header["DATUM"]);
    ensureOwnStyle(dateCell);
    dateCell.numFmt = "d.m.yyyy";

    const spzCell = row.getCell(header["SPZ vozidla"]);
    spzCell.value = spz;
    ensureOwnStyle(spzCell);
    spzCell.alignment = { ...(spzCell.alignment || {}), horizontal: "center" };

    row.getCell(header["ŘIDIČ"]).value = driver;
    if (helper) row.getCell(header["ZÁVOZNÍK 1."]).value = helper;

    const fv = i < fakturaValues.length ? fakturaValues[i] : null;
    const fCell = row.getCell(header["FAKTURA"]);
    if (fv) {
      fCell.value = /^\d+$/.test(fv) ? Number(fv) : fv;
    }
    ensureOwnStyle(fCell);
    fCell.alignment = { ...(fCell.alignment || {}), horizontal: "right" };
    row.commit();
  }
}

/** Bold bottom border across the full row width, marking end of a driver's block. */
function applyBottomBorder(ws, rowNum, lastCol) {
  const row = ws.getRow(rowNum);
  for (let c = 1; c <= lastCol; c++) {
    const cell = row.getCell(c);
    ensureOwnStyle(cell);
    cell.border = { ...(cell.border || {}), bottom: { style: "medium" } };
  }
  row.commit();
}

/**
 * Loads the Statistika workbook ONCE and returns a reusable context object
 * (workbook + sheets + header maps + canonical name list). Call this once
 * per batch run, then call processDay() once per day against it, then
 * finalizeWorkbook() once at the end.
 */
export async function loadStatistika(statistikaBuffer) {
  const statWb = new ExcelJS.Workbook();
  await statWb.xlsx.load(statistikaBuffer);

  const ridiciWs = statWb.getWorksheet("Řidiči");
  if (!ridiciWs) throw new Error("Sheet 'Řidiči' not found in the Statistika file.");
  const canonicalNames = [];
  ridiciWs.eachRow((row) => {
    const v = row.getCell(1).value;
    if (v && typeof v === "string" && v.trim()) canonicalNames.push(v.trim());
  });

  const wsTech = statWb.getWorksheet("Technici");
  const wsHD = statWb.getWorksheet("HD");
  if (!wsTech || !wsHD) throw new Error("Sheets 'Technici' and/or 'HD' not found in the Statistika file.");

  return {
    workbook: statWb,
    canonicalNames,
    wsTech,
    wsHD,
    headerTech: buildHeaderMap(wsTech),
    headerHD: buildHeaderMap(wsHD),
  };
}

/**
 * Processes ONE day's (dailyRoutesBuffer, emailText) pair against an
 * already-loaded Statistika context (from loadStatistika). Mutates the
 * context's workbook in place. Returns { summary, warnings, targetDate }
 * for that single day - call this once per day in a batch, in order.
 */
export function processDay(ctx, dailyRoutesBuffer, emailText) {
  const warnings = [];
  const summary = [];

  const { targetDate, ordersByName } = loadDailyRoutes(dailyRoutesBuffer);
  if (!targetDate) {
    throw new Error("Could not determine the date from the daily route file.");
  }

  const { canonicalNames, wsTech, wsHD, headerTech, headerHD } = ctx;
  const entries = parseEmail(emailText);

  for (const e of entries) {
    const resolved = [];
    for (const rn of e.rawNames) {
      const { name: canon, fuzzy, warning } = matchCanonical(rn, canonicalNames);
      if (warning) warnings.push(warning);
      if (canon === null) {
        warnings.push(
          `[${e.rawLine}] -> could not match name '${rn}' to any name on the Ridici sheet. This line MUST be checked manually.`
        );
      } else if (fuzzy) {
        warnings.push(
          `[${e.rawLine}] -> name '${rn}' matched approximately to '${canon}' (please double-check this is correct).`
        );
      }
      resolved.push(canon);
    }

    if (!resolved.length || !resolved[0]) continue;

    const driver = resolved[0];
    const helper = resolved.length > 1 ? resolved[1] : null;

    const technicianEntry = resolved.some((n) => n && isTechnician(n));
    const ws = technicianEntry ? wsTech : wsHD;
    const header = technicianEntry ? headerTech : headerHD;
    const sheetName = technicianEntry ? "Technici" : "HD";

    let orders = getOrders(ordersByName, driver);
    let usedName = driver;
    if (!orders.length && helper) {
      orders = getOrders(ordersByName, helper);
      usedName = helper;
    }

    if (!orders.length) {
      warnings.push(
        `[${e.rawLine}] -> no orders found in the daily file for '${driver}'` +
          (helper ? ` or '${helper}'` : "") +
          ` on ${targetDate}. Created 1 row with an empty FAKTURA to fill in manually.`
      );
      orders = [null];
    }

    const nExtra = e.expressWindow ? 6 : 0;
    const totalNeeded = orders.length + nExtra;

    const { rows, lastCol, extended } = findOrCreateRows(ws, header, targetDate, totalNeeded);
    if (extended) {
      warnings.push(
        `[${e.rawLine}] -> ran out of pre-dated template rows on sheet '${sheetName}'; ` +
          `some rows were created by copying the row above and stamping in ${targetDate}. Please spot-check formatting.`
      );
    }

    const fakturaValues = [...orders, ...Array(nExtra).fill(null)];
    writeEntry(ws, header, rows, e.spz, driver, helper, fakturaValues);
    applyBottomBorder(ws, rows[rows.length - 1], lastCol);

    summary.push({
      line: e.rawLine,
      sheet: sheetName,
      driver,
      helper,
      usedName,
      ordersFound: orders.filter(Boolean).length,
      rowsWritten: rows.length,
      express: Boolean(e.expressWindow),
    });
  }

  return { summary, warnings, targetDate };
}

/** Writes the final workbook (after all days have been processed) to a buffer. */
export async function finalizeWorkbook(ctx) {
  return await ctx.workbook.xlsx.writeBuffer();
}
