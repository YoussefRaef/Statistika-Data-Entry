// Parses the daily route email text into qualifying entries (lines that
// have a REAL license plate before the dash - everything else, like
// Mi:Bo / Topgo / Smart / Kočí / Relich lines, is skipped).

// Recognizes plates like "7Z4 7615", "7Z47615", "8Z1 2266"
const SPZ_RE = /^\d[A-Za-z]\d\s?\d{3,4}$/;

// "expres 18-21" / "express 18-21" / "Ex 18-21" (all mean the same thing)
const EXPRESS_RE = /\b(?:expres{1,2}|ex)\.?\s+(\d{1,2}\s*-\s*\d{1,2})/i;
// "(7x inst.)"
const INST_RE = /\((\d+)\s*x\s*inst\.?\)/i;
// "sada 3764" (older emails said "set 3764") - informational only, not used
// for FAKTURA since that comes from the daily route file.
const SADA_RE = /\b(?:sada|set)\s+(\d+)\b/i;

// time, then vehicle/route label, then an en-dash or hyphen, then the rest
const LINE_RE = /^\s*(?<time>\d{1,2}:\d{2})\s+(?<vehicle>.+?)\s*[–-]\s*(?<rest>.+?)\s*$/;

export function parseEmail(text) {
  const entries = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const m = LINE_RE.exec(line);
    if (!m) continue;

    const vehicle = m.groups.vehicle.trim();
    const vehicleCompact = vehicle.replace(/\s+/g, "");
    if (!SPZ_RE.test(vehicleCompact) && !SPZ_RE.test(vehicle)) {
      // not a real plate - just a route nickname (Mi:Bo, Topgo, Kočí...)
      continue;
    }

    const rest = m.groups.rest.trim();

    // names sit at the start of 'rest', up to the first digit or bracket
    const nameMatch = /^([^\d(]+)/.exec(rest);
    if (!nameMatch) continue;
    const namesPart = nameMatch[1].trim().replace(/^,+|,+$/g, "");
    const rawNames = namesPart
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    if (rawNames.length === 0) continue;

    const infoPart = rest.slice(nameMatch[0].length);

    const expressM = EXPRESS_RE.exec(infoPart);
    const instM = INST_RE.exec(infoPart);
    const sadaM = SADA_RE.exec(infoPart);

    entries.push({
      time: m.groups.time,
      spz: vehicle,
      rawNames,
      expressWindow: expressM ? expressM[1] : null,
      instHint: instM ? parseInt(instM[1], 10) : null,
      sadaHint: sadaM ? sadaM[1] : null,
      rawLine: line,
    });
  }
  return entries;
}
