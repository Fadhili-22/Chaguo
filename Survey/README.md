# Chaguo survey (phases 1-3)

Static survey in plain HTML, CSS and vanilla JS. No build step, no libraries, no analytics.
Covers: one opening screen (intro, age confirmation and consent), 48 RIASEC items (screens 1-6), two background screens with KUCCPS branching (screens 7-8), a results screen, and saving to a Google Sheet through a Google Apps Script web app (set it up with `apps-script/SETUP.md`). With `SURVEY_ENDPOINT` empty in `js/config.js`, nothing is saved: snapshots are printed to the browser console instead.

## Run it locally (Windows)

**Option A: just open the file.** Double-click `Survey\index.html`. It uses plain `<script>` tags (not ES modules), so it works from `file://`.

**Option B: a local server** (closer to how GitHub Pages will serve it). In PowerShell:

```powershell
cd C:\dev\Chaguo\Survey
python -m http.server 8000
```

Then open <http://localhost:8000>. Stop the server with Ctrl+C.

To try it on your phone, put the phone on the same Wi-Fi, run the server, and open `http://<your-PC-IP>:8000` (find the IP with `ipconfig`).

## Debug helper

Add `?debug=1` to the address (e.g. `index.html?debug=1`). A button appears that fills all 48 items with random answers, answers the attention check correctly (Dislike), fills both background screens with valid random answers (random admission route, so different branches get exercised), and jumps to results. Use `?debug=fail` to answer the attention check wrongly instead. Without the flag the button does not exist.

The finished response is printed to the browser console (F12 -> Console) when results are reached. With `SURVEY_ENDPOINT` empty, every snapshot is printed there too (see Saving). Debug runs are marked `is_test` = `yes`.

## Run the tests

There are six test files. Run them from the `Survey` folder.

**1. Scoring and items** (pure logic; needs Node.js only):

```powershell
node tests/scoring.test.js
```

It also compares all 48 item wordings with `Dataset/RIASEC_data12Dec2018/codebook.txt` when that file is present.

**2. Background questions** (pure logic; needs Node.js only):

```powershell
node tests/background.test.js
```

Branching per admission route, clearing of hidden answers, validation per screen, optional fields, and the 13 response fields.

**3. Browser flow** (drives a real headless browser through every screen at phone width):

```powershell
node tests/browser.test.mjs
node tests/browser.test.mjs --screenshots   # also saves PNGs to tests/screenshots/
```

What it needs:
- **Node.js 22 or newer** (it uses Node's built-in `WebSocket` and `fetch`; check with `node --version`).
- **Google Chrome or Microsoft Edge** installed. It looks in the usual Windows, macOS and Linux locations; if yours is elsewhere, set `CHROME_PATH` to the executable first, e.g. `$env:CHROME_PATH = "D:\Apps\chrome.exe"`.
- **Nothing to install with npm.** No `package.json`, no `node_modules`.

It opens a throwaway browser profile in your temp folder and deletes it afterwards. Screenshots go to `tests/screenshots/`, which is git-ignored. The script exits with a non-zero code if any check fails.

**4. Snapshots** (pure logic; needs Node.js only):

```powershell
node tests/snapshot.test.js
```

The 89-field snapshot: same keys in the same order for partial and complete, `""` for unknown values, growth over the screens, `is_test` rules.

**5. Apps Script** (pure logic; needs Node.js only):

```powershell
node tests/apps-script.test.js
```

Loads `apps-script/Code.gs` in Node and tests validation, cleaning and writing with a fake sheet: bad UUID, wrong schema, unknown keys, out-of-range values, bad choices, overlong text, formula protection, header creation and header mismatch. It also checks that the script's columns and allowed values match the survey's.

**6. Saving in a browser** (same requirements as test 3):

```powershell
node tests/saving.test.mjs
```

Runs the survey against a small local mock endpoint (the survey is copied to a temp folder with `config.js` pointed at the mock). Checks nothing is sent before consent or for under-18s, one full snapshot per screen plus "complete", retry and queue behaviour, the final-failure message and button, the reference code, both `SEND_MODE`s, and the close-page beacon.

## Files

| File | Purpose |
|---|---|
| `index.html` | All screens; one visible at a time |
| `css/styles.css` | Styling; every colour, font and size is a variable on `:root` |
| `js/config.js` | The settings you edit: `SURVEY_ENDPOINT`, `SEND_MODE`, `CONSENT_VERSION` |
| `js/items.js` | The 48 items (exact codebook wording), attention check, screen layout |
| `js/scoring.js` | Pure functions: scores, Holland code, tie rule, response object |
| `js/background.js` | Pure functions: background questions, KUCCPS branching, validation, the 13 background response fields |
| `js/snapshot.js` | Pure functions: the 89-field snapshot (partial or complete), `is_test` |
| `js/sender.js` | Sending, the one-slot retry queue, the close-page beacon |
| `js/app.js` | State, screen flow, timings, rendering, sessionStorage, debug helper, when to save |
| `apps-script/Code.gs` | The Google Apps Script web app (validation, cleaning, append to the Sheet) |
| `apps-script/SETUP.md` | Click-by-click Sheet and deployment guide |
| `tests/scoring.test.js` | Plain-Node tests for items, screens and scoring |
| `tests/background.test.js` | Plain-Node tests for the background questions |
| `tests/browser.test.mjs` | Headless-browser test of the whole flow |
| `tests/snapshot.test.js`, `tests/apps-script.test.js` | Plain-Node tests for snapshots and the Apps Script |
| `tests/saving.test.mjs`, `tests/lib/cdp.mjs` | Headless-browser test of saving against a mock endpoint, and its browser helper |
| `assets/` | Logo files (kept byte-identical with `Web-App/assets/`) |

## Scoring rules

- Score per type = sum of its 8 items (8 to 40). The attention check is never included.
- Holland code = the 3 highest types. **Ties are broken in the fixed order R, I, A, S, E, C.**
- The results screen shows a note only when that rule decided something in the code: a tie inside the top 3, or between 3rd and 4th place. Ties lower down don't change the code, so they are not flagged.

## Interleaved screens

| Screen | Items |
|---|---|
| 1 | R1 I1 A1 S1 E1 C1 R2 I2 |
| 2 | A2 S2 E2 C2 R3 I3 A3 S3 |
| 3 | E3 C3 R4 I4 A4 S4 E4 C4 |
| 4 | R5 I5 A5 S5 **attention check** E5 C5 R6 I6 |
| 5 | A6 S6 E6 C6 R7 I7 A7 S7 |
| 6 | E7 C7 R8 I8 A8 S8 E8 C8 |

## Background questions (screens 7 and 8)

Screen 7 "Your course": course (text), university type, year, how you got into the course (KUCCPS placed / KUCCPS then elsewhere / direct / not sure), switched course?. Screen 8 "A bit about you": satisfaction 1-5, would choose again, gender, age band.

Follow-ups appear inline under their question: route "KUCCPS placed" asks if it was the first choice (required); "KUCCPS then elsewhere" asks which course KUCCPS placed you in (optional, with an "I don't remember" tick); "switched course = Yes" asks which course you started in (optional). Changing an answer clears any follow-up that is now hidden.

## Response object (schema_version "3")

Flat. 84 core fields, in this order: `response_id`, `schema_version`, `started_at`, `finished_at`, `R1..R8`, `I1..I8`, `A1..A8`, `S1..S8`, `E1..E8`, `C1..C8`, `attention_check`, `attention_passed`, `score_R..score_C`, `holland_code`, the 13 background fields below, `time_screen_1..time_screen_8`, `time_total_ms`, `user_agent_is_mobile`. Schema 3 adds 5 sending fields after them (89 from the browser), and the server adds `received_at` (90 columns in the Sheet):

| Field | Values |
|---|---|
| `stage` | `screen_1` ... `screen_8` (last completed screen) / `complete` |
| `is_complete` | `yes` / `no` |
| `client_sent_at` | ISO time of this send (respondent's clock) |
| `consent_version` | from `CONSENT_VERSION` in `js/config.js`, e.g. `2026-10-v1` |
| `is_test` | `yes` when `?debug` is on or the page runs from `file://`, localhost or a LAN address; otherwise `no` |
| `received_at` | added by the server (UTC); not sent by the browser |

In a snapshot sent mid-survey anything not known yet is `""` (unanswered items, scores, `holland_code`, `finished_at`, `attention_*`, timings of screens not reached). The 13 background fields:

| Field | Values |
|---|---|
| `course` | text, trimmed (max 100) |
| `uni_type` | `public` / `private` / `not_sure` |
| `year_of_study` | `year_1` / `year_2` / `year_3` / `year_4` / `year_5_plus` / `graduated_2y` |
| `admission_route` | `kuccps_placed` / `kuccps_elsewhere` / `direct` / `not_sure` |
| `kuccps_first_choice` | `yes` / `no` / `dont_remember`; `""` unless route is `kuccps_placed` |
| `kuccps_placed_course` | text; `""` if not shown, left blank, or "I don't remember" ticked |
| `kuccps_placed_dont_remember` | `yes` / `no` when shown (route `kuccps_elsewhere`); `""` when not shown |
| `switched_course` | `yes` / `no` |
| `original_course` | text; `""` if not shown or left blank |
| `satisfaction` | integer 1-5 |
| `choose_again` | `yes` / `not_sure` / `no` |
| `gender` | `female` / `male` / `prefer_not_to_say` |
| `age_band` | `18_20` / `21_23` / `24_26` / `27_plus` / `prefer_not_to_say` (underscores: Sheets would turn "18-20" into a date) |

**`""` means "this question was not shown"** (or, for an optional text box, "shown but left blank"). It is never a real answer. Hidden follow-ups are cleared whenever their parent answer changes, so a stale answer can't reach the response.

## Saving

- **Snapshots, append-only.** After each completed screen (1-8), and on reaching results (`complete`), the page sends the **whole response so far** as one new row. Rows are never updated or deleted, so one respondent has up to 9 rows. **In analysis keep the latest row per `response_id`** (sort by `received_at`, take the last).
- **Never before consent.** Nothing is sent until "I'm 18 or older, and I agree" is pressed, nothing for under-18s, and nothing until the first screen is complete.
- **Never blocks.** Sends are fire-and-forget. A failed snapshot waits in a one-slot queue (sessionStorage) and is replaced by the next, newer snapshot; the queue survives a refresh. Results appear as soon as the final snapshot is queued; if the final send fails, a calm message with a "Try saving again" button appears.
- **Close-page beacon.** If the page is hidden or closed mid-survey with answers not yet sent, they go out with `navigator.sendBeacon`.
- **Why `text/plain`.** The body is JSON but is sent as `text/plain`, which counts as a "simple" request: the browser skips the CORS preflight (an OPTIONS "may I?" request) that Apps Script cannot answer.
- **`SEND_MODE`.** `"cors"` (default) reads Google's reply to know a save worked. If rows reach the Sheet but the page reports failure, use `"no-cors"` (a finished request counts as saved). See `apps-script/SETUP.md`, step 8.
- **Reference code.** The results screen shows the first 8 characters of `response_id` so a respondent can ask for deletion by email.

## To do before going live

- Set `SURVEY_URL` at the top of `js/app.js` (used in the WhatsApp share text).
- Set `SURVEY_ENDPOINT` in `js/config.js` (see `apps-script/SETUP.md`), and test with your real Sheet.
- Review the opening-screen wording in `index.html` (marked DRAFT). If it changes, bump `CONSENT_VERSION` in `js/config.js`.

## Screen order

Opening screen ("I'm 18 or older, and I agree" starts the survey; "I'm under 18" exits) -> 6 item screens -> background screen 7 -> background screen 8 -> results. The progress bar counts all 8 screens.
