# Launching the survey on GitHub Pages

The survey will live at **https://fadhili-22.github.io/Chaguo/**.

**How publishing works.** You don't upload anything by hand. Every time you push a change under `Survey/` to the `main` branch, a GitHub "workflow" (`.github/workflows/deploy-survey.yml`) runs on GitHub's computers. It runs the quick tests, copies only the files the live survey needs (`index.html`, `css/`, `js/`, `assets/`) into a fresh folder (joining the scripts into one `js/survey.js` so the page loads fast on slow phones), and publishes that folder. Tests, the Apps Script, the docs and the rest of the repo are never published. You can also run it by hand (step 6).

---

## Part 1: Go live (once)

### 1. Check the repo is public
GitHub Pages only works from a **public** repo on a free plan (a private repo needs a paid plan). Yours is public, so everything committed is visible to anyone: the code, the notes, and the Apps Script address in `js/config.js`. Your data is **not** in git (raw data, processed data and responses are in `.gitignore`). Before you push, run `git status` and make sure no personal files (photos, ID, exports) are listed.

### 2. Check the settings in `Survey/js/config.js`

| Setting | Should be |
|---|---|
| `SURVEY_ENDPOINT` | your Apps Script web app address (ends in `/exec`) |
| `SEND_MODE` | `"cors"` (it worked when you tested) |
| `SURVEY_URL` | `https://fadhili-22.github.io/Chaguo/` |
| `SURVEY_OPEN` | `true` |
| `CONSENT_VERSION` | `2026-10-v3`, or a new label if you changed the opening-screen wording |

### 3. Push to GitHub
In PowerShell:

```powershell
cd C:\dev\Chaguo
git status
git push origin main
```

### 4. Turn on GitHub Pages
1. Open <https://github.com/Fadhili-22/Chaguo> and click **Settings** (top row of tabs).
2. In the left menu click **Pages**.
3. Under **Build and deployment**, set **Source** to **GitHub Actions**. (There is no Save button; the choice is saved when you pick it.)

> Do this **before** the first workflow run if you can. If the first run already happened and failed with a message about Pages not being enabled, enable it now and use step 6 to run it again.

### 5. Check the workflow ran
1. Click the **Actions** tab.
2. Click the newest run called **Deploy survey**.
3. A green tick means it published. A red cross means it didn't: click the run, click the **deploy** job, and open the step with the red cross. See "If something goes wrong" below.

### 6. Run it by hand (any time)
**Actions** tab → **Deploy survey** (left list) → **Run workflow** (right) → green **Run workflow** button.

### 7. Find the live URL
- On the finished run, the **deploy** job shows the address next to "github-pages", or
- **Settings → Pages** shows *"Your site is live at …"*.

It should be <https://fadhili-22.github.io/Chaguo/>. Give it a minute after the green tick, then open it.

---

## If something goes wrong

| What you see | Likely cause and fix |
|---|---|
| Red cross on **Run tests** | A test failed, so nothing was published (that's the point). Open the step to see which. |
| Red cross on **Build the site folder** with "Unexpected file type" | A file such as a photo ended up in `Survey/assets/`, `css/` or `js/`. Move it out of the repo and push again. |
| Red cross on **Deploy** with a "Pages not enabled" or "404" message | Step 4 isn't done. Set Source to **GitHub Actions**, then run the workflow again (step 6). |
| The page is blank or a 404 | Wait a minute, hard-refresh (Ctrl+Shift+R), and check the address ends in `/Chaguo/` with a capital C. |
| The page loads but nothing saves | Check `SURVEY_ENDPOINT` in `config.js`, then follow `apps-script/SETUP.md` (Troubleshooting). |
| You changed something but the live page looks the same | Only changes under `Survey/` start a publish. Check the Actions tab for a new run, then hard-refresh. Pages caches files for up to about 10 minutes. |

---

## Part 2: Pre-launch checklist

Tick these off before you share the link.

### Data and Sheet
- [ ] Test rows deleted from the Sheet (every row with `is_test` = `yes`, plus any from earlier test runs).
- [ ] `https://fadhili-22.github.io/Chaguo/?test=1` on the **live** site: walk through once on your phone. Rows appear with `is_test` = `yes` and 9 stages up to `complete`.
- [ ] One last run **without** `?test=1`, to confirm real respondents get `is_test` = `no`. Then delete that row.
- [ ] The Sheet is private (not shared by link), and you know where its data is backed up or exported.
- [ ] The Apps Script web app is deployed with **Who has access: Anyone** and is the current version (`apps-script/SETUP.md`).

### Consent and wording
- [ ] You've read every screen once more. The opening-screen wording is marked DRAFT in `index.html` until you approve it.
- [ ] `CONSENT_VERSION` was changed if you edited the "Before you start" list.
- [ ] The contact email (`njenga.munyua@strathmore.edu`) works, and you know how to delete a respondent's rows from their reference code (`apps-script/SETUP.md`, "Working with the data").
- [ ] You've checked whether you need any approval (for example from your supervisor or the university's research ethics office) before collecting data from students.

### Sharing
- [ ] The preview image (`assets/og-image.png`) and its tagline are approved.
- [ ] Send the live link to yourself on WhatsApp: the preview shows the title, description and image. (WhatsApp remembers previews. If you change the image or text later, share the link with `?v=2` on the end to get a fresh preview.)
- [ ] The WhatsApp button on the results screen opens a message containing the live address.

### On real phones (Android Chrome and iPhone Safari if you can)
- [ ] The opening screen appears quickly on mobile data and nothing needs sideways scrolling.
- [ ] "I'm under 18" shows the polite exit and nothing appears in the Sheet.
- [ ] Refresh in the middle of the survey: you come back to the same screen with your answers.
- [ ] Switch on airplane mode on screen 3, finish the survey, then switch it off and tap **Try saving again** if it appears: the complete row arrives in the Sheet.
- [ ] The reference code on the results screen matches the start of `response_id` in the Sheet.

### Housekeeping
- [ ] `git status` is clean and nothing sensitive is in the repo (no data exports, photos or keys).
- [ ] You know how to close the survey: set `SURVEY_OPEN = false` in `js/config.js`, commit and push. Within a couple of minutes the live page shows "This survey has now closed" and nothing is sent.
- [ ] You know where the Actions tab is, in case the workflow fails after a later change.

---

## Useful things to know

- **`?test=1`**: add it to the address to mark your own runs as tests (`is_test` = `yes`) without showing the debug button. `?debug=1` does the same and also shows the "fill answers" button. Neither has any effect on other people's visits.
- **Closing the survey** (`SURVEY_OPEN = false`) also stops anything left waiting in someone's browser from being sent.
- **Changing where answers go:** if you ever deploy the Apps Script as a *new* deployment, the address changes. Put the new one in `config.js`. The page's security policy (in `index.html`) already allows `script.google.com`, so nothing else needs changing. Keep the `SURVEY_ENDPOINT` an address that starts with `https://script.google.com/`.
- **Fonts (phase 5):** IBM Plex is self-hosted in `assets/fonts/` (four woff2 files plus the licence), so the security policy only needed `font-src 'self'`. No outside font service is used.
