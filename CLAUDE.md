# Chaguo — project guide for Claude Code

Chaguo ("choice" in Swahili) helps Kenyan KCSE leavers choose what to study. A student takes an interest test, a model ranks interest clusters and suggests courses, and rules match those courses to universities they can actually get into and afford.

Owner: Fadhili Munyua (BSc Informatics & CS, Strathmore; Data Science bootcamp, Moringa School).
Research contact (used on the survey consent screen): njenga.munyua@strathmore.edu

---

## How we work

- Prompts are planned in a separate chat. You (Claude Code) implement **one phase at a time**. Never build ahead into the next phase, even if it seems quick.
- Before writing code for a phase, show a short plan (files, approach, open questions) and wait for approval.
- Fadhili is learning as he builds. Explain decisions briefly in plain language, and prefer simple, defensible solutions over clever ones. No frameworks or build steps unless a phase asks for them.
- At the end of each phase: summarise what was built, how to test it, and what is still open. Then update the **Progress** section at the bottom of this file.
- Only write inside the folder the current task is about.
- Never add "Co-Authored-By" or "Generated with Claude Code" lines to commit messages or PR descriptions. Commit messages contain only the message itself.

## Folder layout

```
Chaguo/
├── CLAUDE.md        ← this file (project-wide context)
├── Dataset/         ← Open Psychometrics RIASEC data + analysis for the Stage I model
│   ├── RIASEC_data12Dec2018/   raw download (data + codebook) — READ-ONLY
│   ├── config/
│   ├── notebooks/
│   ├── notes/       ← see here for what analysis has been done so far
│   └── processed/
├── Survey/          ← anonymous Kenyan university-student survey (static site → GitHub Pages); phases 1–2 built
└── Web-App/         ← the Chaguo product itself (not started; empty)
```

Folder names are capitalised on disk. Git is initialised once at the `Chaguo/` root (branch `main`); raw and processed data are git-ignored.

Data rules:
- Never modify anything in `Dataset/RIASEC_data12Dec2018/`. Derived files go in `Dataset/processed/`.
- Never commit raw data, survey responses, or any file containing respondent data.

## The product

**Stage I — interests → courses (ML).**
RIASEC interest test: 48 Open Psychometrics items, wording unchanged, answered 1–5 (1 = Dislike, 3 = Neutral, 5 = Enjoy). A model ranks 14 Chaguo interest clusters and returns the top 5 courses.

**Stage II — courses → universities (rules, no ML).**
For each course: minimum C+ eligibility, subject minimums, estimated cluster weight vs last year's cut-off → Safe / Target / Reach, plus fees and county.

The 14-cluster list in the project description doc is a reconstruction and still needs confirming against the originally agreed list.

## Data plan

- **Open Psychometrics RIASEC dataset** — volume for training.
- **Kenyan survey** (this repo's `Survey/`) — anonymous, university students aged 18+. Target 300–500 responses across many courses.
- Role of the Kenyan data, decided by size after collection (rules to be written into the project doc *before* looking at the data):
  - fewer than 150 → test set only
  - roughly 300–500 → fine-tune, or weighted pooling with the main dataset
  - thousands or more → can carry the model
- Known limits: labels are "what people study", not "what they enjoy"; interests are measured after studying; items are thin on tech. Key validation question: does model–course match predict satisfaction in the Kenyan data?

## Survey spec (`Survey/`)

Static site (plain HTML/CSS/JS) on GitHub Pages; responses go to a Google Sheet via Google Apps Script.

Flow:
1. Opening screen (one screen): short friendly intro (what Chaguo is, why current university students, what you get), a compact one-line bulleted "Before you start" list (anonymous, voluntary, about 7 to 10 minutes, answers saved as you go and used for research and to train Chaguo's model, contact email above + deletion on request using the reference code shown at the end), and two buttons. "I'm 18 or older, and I agree — start" counts as both age confirmation and consent and starts the timing; "I'm under 18" exits politely, nothing recorded (sessionStorage flag, so a refresh goes straight to the exit screen).
2. 48 RIASEC items, interleaved R1, I1, A1, S1, E1, C1, R2, I2 … C8, across 6 screens of 8. One attention-check item on screen 4.
3. Background questions (phase 2, built) with KUCCPS branching, on two screens (7 "Your course", 8 "A bit about you"); the progress bar covers all 8 screens. Logic lives in `Survey/js/background.js` (pure functions, tested in Node):
   - Screen 7: course (free text, required, max 100), university type (public/private/not sure), year of study, how you got into the course, switched course?
   - Admission route branching (follow-up shown inline, hidden answers are cleared when the route changes):
     - placed by KUCCPS → "Was this course your first choice on your KUCCPS application?" (required)
     - applied via KUCCPS but went elsewhere → "What course did KUCCPS place you in?" (free text, optional, with an "I don't remember" checkbox)
     - applied directly, or not sure → no follow-up
   - Switched course = Yes → "What course did you start in?" (optional)
   - Screen 8: satisfaction 1–5 (all five labelled), would you choose this course again?, gender, age band.
   - Free text is trimmed only; course names are not corrected or mapped in the survey (mapping to clusters happens in analysis).
   - Response schema_version "3": 84 core fields + 5 sending fields (`stage`, `is_complete`, `client_sent_at`, `consent_version`, `is_test`) = 89 from the browser; the server adds `received_at`. Questions not shown, and anything not known yet in a mid-survey snapshot, are `""` (never a real answer). Field list and machine values are in `Survey/README.md`.
4. Results screen: RIASEC scores, Holland code, WhatsApp share, the respondent's reference code (first 8 characters of `response_id`; deletion is by emailing the research contact with it), and a calm "Try saving again" message only if the final save failed.
Timings are recorded (per screen and total).

Saving (phase 3, built):
- Endpoint and settings live in `Survey/js/config.js` (`SURVEY_ENDPOINT`, `SEND_MODE` "cors" | "no-cors", `CONSENT_VERSION`). Empty endpoint = saving off, snapshots are console.logged. Bump `CONSENT_VERSION` whenever the opening-screen wording changes.
- After each completed screen (1–8) and on reaching results (`complete`) the page POSTs a FULL SNAPSHOT (`text/plain` body, so no CORS preflight) to the Apps Script web app (`Survey/apps-script/Code.gs`), which appends one row to the Sheet. Append-only: analysis keeps the latest row per `response_id` (sort by `received_at`).
- Nothing is sent before consent, for under-18s, or before the first screen is complete. Sending never blocks the respondent; a failed snapshot waits in a one-slot sessionStorage queue and is superseded by the next one. `navigator.sendBeacon` sends unsent answers when the page is closed mid-survey (unverified against real Apps Script until deployed).
- The script whitelists columns, caps lengths, checks enums and ranges, and prefixes `'` to strings starting with `= + - @` (tab/CR/LF) so Sheets never reads them as formulas (a leading `'` in a course name is that protection). Setup guide: `Survey/apps-script/SETUP.md`.

Build phases (one Claude Code prompt each):
1. Scaffold + opening screen (age + consent) + items + scoring/results (no saving)
2. Background questions + branching
3. Google Sheet + Apps Script saving
4. Quality checks + deploy
5. Branding

## Brand

- Logo: purple line-art torch beside bold lowercase "chaguo" (SVG still to make).
- Logo files live in two places: `Survey/assets/` and `Web-App/assets/`. Each holds the same pair, `chaguo-logo.png` and `chaguo-logo-transparent.png`. **The two copies must stay byte-identical** — if you change a logo, update both folders in the same commit.
- Colours: primary `#8200DB`, text `#0C0A09`, muted `#79716B`, borders `#E7E5E4`, fills `#F5F5F4`, light purple `#E9D4FF` / `#F3E8FF`, purple on dark backgrounds `#AD46FF`. White/stone neutrals. Square corners (border-radius 0).
- Type: IBM Plex Sans (headlines, body), IBM Plex Mono (eyebrows/labels), Bricolage Grotesque (wordmark only).
- Layout feel: technical-editorial — big bold headlines, mono eyebrows, numbered sections, bordered cards, stat strips, callouts, score bars.

Branding is applied in survey phase 5; earlier phases keep styling minimal but use CSS variables so the brand can be dropped in later.

## Progress

- [x] Product concept and two-stage design
- [x] Brand and logo decided
- [x] Open Psychometrics dataset downloaded and initial processing started (`Dataset/`)
- [x] Survey phase 1 — scaffold, consent, items, scoring/results (built; opening-screen copy is a DRAFT awaiting review)
- [x] Survey phase 2 — background questions + branching (built, both test suites pass; question wording is a DRAFT awaiting review; not yet committed, awaiting manual test)
- [x] Survey phase 3 — Sheet + Apps Script saving (built; all six test suites pass; formula neutralising and "saved as you go" consent wording done; consent wording is a DRAFT awaiting review; not yet committed — awaiting a real-Sheet test: deploy per `Survey/apps-script/SETUP.md`, check `SEND_MODE` "cors" vs "no-cors" and the close-tab beacon)
- [ ] Survey phase 4 — quality checks + deploy
- [ ] Survey phase 5 — branding
- [ ] Confirm the 14-cluster list
- [ ] Write pre-registered decision rules for the Kenyan data into the project doc
- [ ] Logo: SVG, small-size torch, dark-background version
- [ ] Web app (not started)
