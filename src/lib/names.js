// Name normalization + matching helpers (port of the Python strip_diacritics /
// norm / match_canonical functions).

export function stripDiacritics(s) {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function norm(s) {
  return stripDiacritics(String(s)).toUpperCase().trim().replace(/\s+/g, " ");
}

// Simple Levenshtein distance, used for fuzzy name matching (stand-in for
// Python's difflib.get_close_matches).
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

// Similarity ratio in [0,1], roughly matching difflib's SequenceMatcher.ratio()
// closely enough for our cutoff-based fuzzy matching use case.
function similarity(a, b) {
  if (a.length === 0 && b.length === 0) return 1;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - dist / maxLen;
}

/**
 * Finds the exact canonical spelling (from the Ridici sheet) for a name
 * written in the email, e.g. 'Putz' -> 'PUTZ Daniel'.
 * Returns { name: string|null, fuzzy: boolean, warning: string|null }
 */
export function matchCanonical(rawName, canonicalNames) {
  const rawNorm = norm(rawName);

  const exact = canonicalNames.filter((c) => norm(c).split(/\s+/)[0] === rawNorm);
  if (exact.length === 1) {
    return { name: exact[0], fuzzy: false, warning: null };
  }
  if (exact.length > 1) {
    return {
      name: exact[0],
      fuzzy: false,
      warning: `Multiple possible matches for name '${rawName}': ${exact.join(", ")} -> used '${exact[0]}'`,
    };
  }

  // fuzzy match on surname
  let best = null;
  let bestScore = 0;
  for (const c of canonicalNames) {
    const surname = norm(c).split(/\s+/)[0];
    const score = similarity(rawNorm, surname);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best && bestScore >= 0.72) {
    return { name: best, fuzzy: true, warning: null };
  }

  return { name: null, fuzzy: false, warning: null };
}

const TECHNICIANS = new Set(["BARTES", "DOKULIL", "JAKUBEC"]);

export function isTechnician(canonicalName) {
  const surname = norm(canonicalName).split(/\s+/)[0];
  return TECHNICIANS.has(surname);
}
