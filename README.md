# Route Email → Statistika (web app)

A small React app that does the same thing as `process_email.py`, but as a
web page: upload the daily route file + the Statistika file, paste the
email, download a filled-in copy. Everything runs **in the browser** —
no server, no upload, your files never leave your computer.

## What's new vs. the Python script

- **Bold bottom border** under the last row of each driver's block (both
  sheets).
- **FAKTURA numbers are right-aligned.**
- **Fixed the "ran out of rows" bug**: if a driver's block runs past the
  last pre-dated template row, the app now creates more rows by copying
  the row above (same colors/REGION/POBOČKA) and stamping in the correct
  date, instead of silently writing fewer rows than needed.
- Updated the email parser for the current wording: `zk` (not `ex`/`exp`),
  `expres` (Czech spelling), `sada` (instead of `set`).

## Running it locally

You'll need [Node.js](https://nodejs.org) installed (18+ is fine).

```bash
cd route-entry-app
npm install
npm run dev
```

Then open the URL it prints (usually `http://localhost:5173`).

## Deploying to Vercel

1. Push this folder to a GitHub repo (or use the Vercel CLI directly).
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import
   the repo.
3. Vercel auto-detects it as a Vite app. Leave the defaults:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Click **Deploy**. You'll get a URL like `your-app.vercel.app`.

Or, from the command line, inside the folder:

```bash
npm install -g vercel
vercel
```

and follow the prompts (first deploy asks a few setup questions, then
every `vercel --prod` after that just redeploys).

No environment variables, database, or backend needed — it's a fully
static site.

## Project structure

```
src/
  App.jsx            – the UI (file inputs, email textarea, results)
  main.jsx           – React entry point
  styles.css
  lib/
    parseEmail.js     – regex parsing of the email text
    names.js          – name normalization + fuzzy matching vs. Řidiči sheet
    dailyRoutes.js     – reads "Detaily tras" from the daily route file
    process.js        – ties it together, writes the new Statistika file
```

## Known limitations (same as the Python version)

- Doesn't guess which install-type (columns 0-6) an "(Nx inst.)" note
  belongs to.
- If a name doesn't closely match anything on the Řidiči sheet, it's
  skipped and flagged rather than guessed.
- Assumes the daily route file covers one day at a time.
