import React, { useState } from "react";
import { loadStatistika, processDay, finalizeWorkbook } from "./lib/process.js";

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

let nextId = 1;
function newDay() {
  return { id: nextId++, dailyFile: null, emailText: "" };
}

export default function App() {
  const [statFile, setStatFile] = useState(null);
  const [days, setDays] = useState([newDay()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null); // { url, filename, perDay: [{targetDate, summary, warnings}] }

  const canSubmit =
    statFile &&
    days.length > 0 &&
    days.every((d) => d.dailyFile && d.emailText.trim().length > 0) &&
    !busy;

  function updateDay(id, patch) {
    setDays((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  }

  function addDay() {
    setDays((prev) => [...prev, newDay()]);
  }

  function removeDay(id) {
    setDays((prev) => (prev.length > 1 ? prev.filter((d) => d.id !== id) : prev));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const statBuffer = await readFileAsArrayBuffer(statFile);
      const ctx = await loadStatistika(statBuffer);

      const perDay = [];
      for (const day of days) {
        const dailyBuffer = await readFileAsArrayBuffer(day.dailyFile);
        const { summary, warnings, targetDate } = processDay(ctx, dailyBuffer, day.emailText);
        perDay.push({ targetDate, summary, warnings, fileName: day.dailyFile.name });
      }

      const buffer = await finalizeWorkbook(ctx);
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const filename = statFile.name.replace(/\.xlsx$/i, "") + `_updated_${stamp}.xlsx`;

      setResult({ url, filename, perDay });
    } catch (err) {
      console.error(err);
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container">
      <h1>Route email → Statistika</h1>
      <p className="subtitle">
        Upload the Statistika file once, then add one entry per day (that day's route file +
        that day's email). Process them all in one go and download a single updated file.
        Nothing is uploaded anywhere — this all runs in your browser.
      </p>

      <form onSubmit={handleSubmit}>
        <div className="card">
          <h2>Statistika file</h2>
          <label htmlFor="stat">The Statistika...xlsx file to fill in (Technici / HD / Řidiči)</label>
          <input
            id="stat"
            type="file"
            accept=".xlsx"
            onChange={(e) => setStatFile(e.target.files[0] || null)}
          />
          {statFile && <div className="file-name">Selected: {statFile.name}</div>}
        </div>

        {days.map((day, idx) => (
          <div className="card day-card" key={day.id}>
            <div className="day-card-header">
              <h2>Day {idx + 1}</h2>
              {days.length > 1 && (
                <button type="button" className="remove-btn" onClick={() => removeDay(day.id)}>
                  Remove
                </button>
              )}
            </div>

            <label>Daily route file (.xls / .xlsx)</label>
            <input
              type="file"
              accept=".xls,.xlsx"
              onChange={(e) => updateDay(day.id, { dailyFile: e.target.files[0] || null })}
            />
            {day.dailyFile && <div className="file-name">Selected: {day.dailyFile.name}</div>}

            <label style={{ marginTop: 14 }}>Email text for this day</label>
            <textarea
              value={day.emailText}
              onChange={(e) => updateDay(day.id, { emailText: e.target.value })}
              placeholder={"6:45 Mi:Bo – Beneš 6 16zk sada 3764\n7:15 8Z1 2266 – Jakubec, Trenda 7zk (7x inst.)\n..."}
            />
          </div>
        ))}

        <button type="button" className="secondary" onClick={addDay} style={{ marginBottom: 16 }}>
          + Add another day
        </button>

        <div>
          <button className="primary" type="submit" disabled={!canSubmit}>
            {busy ? "Processing…" : `Process all (${days.length} day${days.length > 1 ? "s" : ""})`}
          </button>
        </div>
      </form>

      {error && <div className="error-box">{error}</div>}

      {result && (
        <div className="result-box" style={{ marginTop: 20 }}>
          <h2>Done — {result.perDay.length} day(s) processed</h2>
          <a className="download-btn" href={result.url} download={result.filename}>
            Download {result.filename}
          </a>

          {result.perDay.map((pd, i) => (
            <div key={i} style={{ marginTop: 22 }}>
              <h3 style={{ fontSize: 14, marginBottom: 6 }}>
                {pd.fileName} — detected date: {pd.targetDate}
              </h3>
              {pd.summary.length === 0 && <p>No qualifying lines were found in the email.</p>}
              {pd.summary.map((s, j) => (
                <div className="entry-line" key={j}>
                  <span className={`tag ${s.sheet === "Technici" ? "tech" : "hd"}`}>{s.sheet}</span>
                  {s.express && <span className="tag express">EXPRESS +6</span>}
                  <strong>{s.driver}</strong>
                  {s.helper ? ` + ${s.helper}` : ""} — {s.ordersFound} order(s), {s.rowsWritten} row(s)
                  written
                  <div className="raw">{s.line}</div>
                </div>
              ))}

              {pd.warnings.length > 0 && (
                <div className="warnings">
                  <h3>Please check manually ({pd.warnings.length})</h3>
                  <ul>
                    {pd.warnings.map((w, k) => (
                      <li key={k}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="privacy-note">
        Your files are processed locally in this browser tab and are never sent to a server.
      </p>
    </div>
  );
}