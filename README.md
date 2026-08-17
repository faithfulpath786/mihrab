# Mihrab

A production-ready, framework-free farz prayer slot clock and private salah notebook. It uses exact UTC day arithmetic for the historical count, a built-in solar prayer-time engine, local-first storage, optional Supabase sync, CSV backups, PWA caching, and strict Row Level Security.

## What already works without setup

Open `index.html` or serve this directory statically. The historical clock, Hyderabad prayer times, Today controls, Taklif calculator, hayd exclusion, optional qada estimate, notebook, calendar, undo, CSV export, manual prayer times, city presets and local persistence all work without an account.

For the most reliable local test (and to test the service worker), serve it over HTTP:

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Cloud setup — required only for account sync

1. **Create Supabase**
   - Create a project at Supabase.
   - Open **SQL Editor**, paste all of `schema.sql`, and run it.
   - In **Project Settings → API**, copy the Project URL and public anon key.

2. **Connect the web app**
   - Fastest test: click **Sign in** in Mihrab and enter the URL and anon key in the Cloud Setup panel. This stores the public configuration in that browser.
   - Recommended deployment: put them in `DEPLOYMENT_CONFIG` at the top of `app.js`, then redeploy.
   - Never put the service-role key in `app.js`.

3. **Configure authentication**
   - In **Authentication → URL Configuration**, set the production site URL.
   - Add the exact production URL (and localhost while testing) to **Redirect URLs**.
   - Email magic links work after email auth is enabled.
   - For Google, enable **Authentication → Providers → Google** and add the Google OAuth credentials shown by Supabase.

4. **Verify privacy before launch**
   - Create account A and mark one prayer.
   - Create account B in a private/incognito window.
   - In Supabase SQL Editor, use the RLS policy simulator or test through the app: B must see zero rows from A.
   - Do not launch if any of the four tables has RLS disabled.

## Deploy

### GitHub Pages

1. Create a repository for the frontend. It may be public; this repository contains no secret server key or database dump.
2. Push this directory to its default branch, with `index.html` at the repository root.
3. In **Settings → Pages**, choose **Deploy from a branch**, then select `main` and `/ (root)`.
4. Add the final Pages URL to Supabase Auth redirect URLs.
5. If using SQL backups, send them to a second private repository as described below.

### Netlify

Drag this directory into Netlify Drop, or connect the repository. There is no build command and the publish directory is the repository root.

## GitHub Actions and backups

The GitHub Pages/frontend repository may be public. Database backups must therefore be written to a **second, private repository**—never to the frontend repository.

First create a separate private repository, initialize it with a README, and create a fine-grained GitHub Personal Access Token that has **Contents: Read and write** access only to that private backup repository.

In the frontend repository under **Settings → Secrets and variables → Actions**, add:

- `SUPABASE_URL` — e.g. `https://project-ref.supabase.co`
- `SUPABASE_ANON_KEY` — the public anon key
- `SUPABASE_DB_URL` — the direct/session-pooler PostgreSQL connection string from Supabase Database settings
- `BACKUP_REPOSITORY` — `your-github-name/your-private-backup-repo`
- `BACKUP_PAT` — the fine-grained token for that private repository

Then:

1. Run **Actions → supabase-keepalive → Run workflow** and confirm success.
2. Run **Actions → weekly-private-database-backup → Run workflow**.
3. Confirm that a dated file appears under `backups/` in the separate private repository.
4. The workflow refuses to write a dump if the destination equals the frontend repository.
5. The workflow removes dated dump files older than 90 days. Git history can retain earlier versions, so use repository retention/rotation appropriate to your privacy policy if hard deletion is required.

## Acceptance test

- Open the browser console: all four `MIHRAB golden test` lines must say `PASS`.
- On 17 Aug 2026 at about 5:30 PM IST in Hyderabad, the hero count is `2,566,687`; Maghrib increments it by exactly one.
- Enter DOB `17 Aug 1995` with Age 13: result is `32,870`, accountable since `17 Aug 2008`.
- Start noting, mark the open prayer, reload, and confirm it remains.
- Sign in and confirm the mark appears in `prayer_logs` within seconds.
- Go offline, make a mark, reconnect, and confirm the sync pill returns to `Synced ✓`.
- Clear browser site data, sign in again, and confirm cloud history returns.
- Test a second account to prove RLS isolation.
- Export CSV and open it in a spreadsheet.
- Check a 360 px viewport for horizontal overflow and keyboard-only navigation.

## Historical and fiqh boundaries

The epoch is explicitly a convention: Dhuhr, 27 February 621 CE, associated with the commemoration of 27 Rajab. No interface claims that date is certified. The Ummah count uses real solar days and opens one new slot at each locally calculated prayer time. Hijri years are display context only. The Age 13 setting is labelled as an average, not a fatwa.
