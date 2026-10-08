# Chaguo survey (phases 1-2)

Static survey in plain HTML, CSS and vanilla JS. No build step, no libraries, no analytics.
Covers: one opening screen (intro, age confirmation and consent), 48 RIASEC items (screens 1-6), two background screens with KUCCPS branching (screens 7-8), and a results screen. **Nothing is saved anywhere yet** (phase 3).

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

The finished response object is printed to the browser console (F12 -> Console) when results are reached.

## Run the tests

There are three test files. Run them from the `Survey` folder.

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

## Files

| File | Purpose |
|---|---|
| `index.html` | All screens; one visible at a time |
| `css/styles.css` | Styling; every colour, font and size is a variable on `:root` |
| `js/items.js` | The 48 items (exact codebook wording), attention check, screen layout |
| `js/scoring.js` | Pure functions: scores, Holland code, tie rule, response object |
| `js/background.js` | Pure functions: background questions, KUCCPS branching, validation, the 13 background response fields |
| `js/app.js` | State, screen flow, timings, rendering, sessionStorage, debug helper |
| `tests/scoring.test.js` | Plain-Node tests for items, screens and scoring |
| `tests/background.test.js` | Plain-Node tests for the background questions |
| `tests/browser.test.mjs` | Headless-browser test of the whole flow |
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

## Response object (schema_version "2")

Flat, 84 fields, in this order: `response_id`, `schema_version`, `started_at`, `finished_at`, `R1..R8`, `I1..I8`, `A1..A8`, `S1..S8`, `E1..E8`, `C1..C8`, `attention_check`, `attention_passed`, `score_R..score_C`, `holland_code`, the 13 background fields below, `time_screen_1..time_screen_8`, `time_total_ms`, `user_agent_is_mobile`.

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

## To do before going live

- Set `SURVEY_URL` at the top of `js/app.js` (used in the WhatsApp share text).
- Review the opening-screen wording in `index.html` (marked DRAFT). Phase 3: update it to say answers are saved as you go (TODO comment in place).
- Remove the `data-phase1-note` line on the results screen once saving exists (phase 3).

## Screen order

Opening screen ("I'm 18 or older, and I agree" starts the survey; "I'm under 18" exits) -> 6 item screens -> background screen 7 -> background screen 8 -> results. The progress bar counts all 8 screens.
