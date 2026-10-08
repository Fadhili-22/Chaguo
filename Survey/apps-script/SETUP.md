# Setting up saving (Google Sheet + Apps Script)

You do this once. It takes about 15 minutes and costs nothing. At the end, every survey screen a respondent completes adds a row to a Google Sheet that you own.

**How it fits together:** the survey page sends a small bundle of answers (a "snapshot") to a web address that Google gives you. A short script (`Code.gs`) behind that address checks the bundle and adds one row to your Sheet.

You need: a Google account, and the file `Survey/apps-script/Code.gs` open in any text editor (Notepad is fine).

---

## 1. Create the Sheet

1. Go to <https://sheets.new> (signed in to the Google account that should own the data).
2. Click the title at the top-left ("Untitled spreadsheet") and rename it to **Chaguo survey responses**.
3. At the bottom, **double-click the tab called "Sheet1"** and rename it to exactly **`Responses`** (capital R, no spaces). Leave it empty: the script writes the header row itself.

> Keep this Sheet **private**. Don't share it with anyone you don't want reading the responses.

## 2. Paste the script

1. In the Sheet's menu bar click **Extensions → Apps Script**. A new tab opens with a code editor and a file called `Code.gs` containing a few lines (`function myFunction() {}`).
2. Click inside the editor, press **Ctrl+A** (select all), then **Delete**.
3. Open `Survey/apps-script/Code.gs` from this project, press **Ctrl+A**, **Ctrl+C**, then go back to the editor and press **Ctrl+V**.
4. Click the **Save** icon (floppy disk) or press **Ctrl+S**.
5. Optional: click "Untitled project" at the top and rename it **Chaguo survey**.

> The script is attached to this one Sheet (that's why you opened it from the Sheet's Extensions menu). It writes to that Sheet automatically; there is no Sheet ID to copy.

## 3. Deploy it as a web app

1. Click the blue **Deploy** button (top-right) → **New deployment**.
2. Next to "Select type" click the **gear icon** → **Web app**.
3. Fill in:
   - **Description:** `Chaguo survey v1`
   - **Execute as:** **Me** (your email)
   - **Who has access:** **Anyone**
4. Click **Deploy**.

"Anyone" is required: respondents aren't signed in to Google, so the page must be able to reach the address without a login. See "What 'Anyone' means" at the end.

## 4. Authorise it (first time only)

Google asks you to allow the script to edit your Sheet.

1. Click **Authorize access** and choose your Google account.
2. You'll see **"Google hasn't verified this app"**. That's normal: it's your own script and you haven't submitted it to Google for review. Click **Advanced**, then **Go to Chaguo survey (unsafe)**.
3. Click **Allow**. (It asks to "See, edit, create, and delete all your Google Sheets spreadsheets" because that's how scripts get permission to write to a Sheet. The script only ever adds rows to this one Sheet.)

## 5. Copy the web app URL

After deploying you see **Web app → URL**, a long address that looks like
`https://script.google.com/macros/s/AKfycb…/exec`.
Click **Copy**. (You can find it again later under **Deploy → Manage deployments**.)

Check it works: paste the URL into a new browser tab. You should see
`{"ok":true,"service":"chaguo-survey","schema_version":"3"}`.
If you see a Google sign-in page instead, "Who has access" is not set to **Anyone**: fix it under step 3 (and see "Redeploying" below).

## 6. Put the URL in the survey

Open `Survey/js/config.js` and paste the URL between the quotes:

```js
var SURVEY_ENDPOINT = "https://script.google.com/macros/s/AKfycb…/exec";
var SEND_MODE = "cors";
```

Leave `SEND_MODE` as `"cors"` for now. Save the file.

> Leaving `SURVEY_ENDPOINT` as `""` switches saving off again (answers are only printed in the browser console), which is what you want for casual local testing.

## 7. Run one real test

1. Open `Survey/index.html` (double-click it), or use the local server described in the README.
2. Open the browser console: press **F12**, then click the **Console** tab. Keep it open.
3. Click "I'm 18 or older, and I agree — start", answer screen 1 and click **Next**.
4. Switch to your Sheet. Within a few seconds the `Responses` tab should show a header row (90 column names) and one data row with `stage` = `screen_1`. (If you don't see it, reload the Sheet tab.)
5. Carry on to the end. You should get one more row per screen: `screen_2` … `screen_8`, then `complete`. All rows from this test have `is_test` = `yes` (because the page runs from a local file or `localhost`), so you can filter them out later.
6. On the results screen you should see **no** message about saving, and a "Your reference code" line. The code is the first 8 characters of the `response_id` in the Sheet.
7. **Close-tab test:** start again, answer a screen, **tick one answer on the next screen without clicking Next**, then close the tab. After a few seconds a new row should appear holding that extra answer. (This uses a browser feature called `sendBeacon`. It should work with Apps Script, but this is the one thing that could not be tested without a real deployment. If it doesn't add a row, nothing is broken: you only lose the answers given on the one screen the respondent was on when they left.)
8. The quick way: add `?debug=1` to the address (`index.html?debug=1`) and click the debug button to fill everything and jump to results. That sends only the final row.

## 8. If saves look failed but the rows ARE in the Sheet

This is the one thing that depends on how Google answers, and it could only be checked once deployed.

- **What you might see:** the results screen shows *"We couldn't save your answers just now…"*, and the console shows yellow warnings like *"Chaguo: saving failed (SEND_MODE is "cors")…"*, **but** when you look at the Sheet the rows are there.
- **What it means:** the data is arriving, but your browser isn't allowed to read Google's reply, so the page can't tell it worked.
- **The fix:** in `js/config.js` change `var SEND_MODE = "cors";` to `var SEND_MODE = "no-cors";`, save, reload, and run the test in step 7 again. In this mode the page counts a request that finishes without a network error as saved.
- **The trade-off:** in `"no-cors"` mode the page can no longer see a refusal from the script, only network failures. That's acceptable because the script only refuses data the survey itself would never send.
- **If there are no rows either:** it's a real failure, so see Troubleshooting below. Do **not** switch to `"no-cors"` for that.

Keep `"cors"` if step 7 worked cleanly.

## Redeploying after you change the script

Saving the code in the editor does **not** change the live web app. After any edit to `Code.gs`:

1. **Deploy → Manage deployments**.
2. Click the **pencil (Edit)** icon next to your deployment.
3. Under **Version** choose **New version**, then click **Deploy**.

This **keeps the same URL**, so you don't need to touch `config.js`.

Don't use **Deploy → New deployment** for an update: that creates a *second* web app with a **new URL**. Your survey would keep sending to the old one (running the old code) until you paste the new URL into `config.js`.

If you change the layout of the columns (a new schema version), the script writes to a new tab named `Responses_schema_3` (or the matching version) instead of putting data in the wrong columns. That happens only if the header row of `Responses` doesn't match, so don't edit the header row by hand.

## Working with the data

- **Every send is a new row.** A respondent who completes all 8 screens produces 9 rows (`screen_1` … `screen_8`, `complete`). Rows are never updated.
- **To get one row per person**, keep the latest row per `response_id`. In Python/pandas:

  ```python
  df = df.sort_values("received_at").groupby("response_id").tail(1)
  complete = df[df["is_complete"] == "yes"]   # finished respondents only
  live = complete[complete["is_test"] == "no"]  # drop your own test runs
  ```

  `received_at` is added by Google (UTC). `client_sent_at` is the respondent's own clock, so don't sort by that.
- **Text starting with `=`, `+`, `-` or `@`** (in the course fields) is saved with a leading `'` so Sheets treats it as plain text. When you load the data, a leading `'` in a course name is that protection, not part of what the student typed.
- **`""` means not answered / not shown**, never a real answer (same as the survey's response schema in the README).
- **Deleting a respondent** (they emailed their reference code): in the Sheet use **Ctrl+F** to find the 8-character code (it is the start of `response_id`), and delete every row for that `response_id` (rows from each screen). Reply to confirm.

## What "Anyone" means (the endpoint is public)

The web app address has to be open to anyone, because the survey runs in strangers' browsers and has no password it could safely hide. Practically:

- Anyone who finds the address (for example by viewing the page source) can send data to it. Nobody can **read** the Sheet through it, and nobody can change or delete existing rows: the script only ever appends.
- The script protects the Sheet by accepting only the survey's exact format: a UUID `response_id`, `schema_version` `"3"`, known columns only, numbers and choices restricted to the allowed values, text cut to length, formulas defused. A request with a bad `schema_version` or `response_id` is refused outright, and any single value outside its allowed range is blanked (stored as empty). A determined person could still add fake-looking rows that fit the format. That's why analysis keeps the latest row per `response_id`, and why `is_test` and the completeness checks matter.
- Don't put anything secret in the Sheet or the script, and don't share the Sheet's own link publicly.
- Google limits how fast a script can be called and how big a Sheet can get (10 million cells; at 90 columns that is over 100,000 rows, far more than 500 respondents need).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Opening the URL shows a Google sign-in page | "Who has access" isn't **Anyone**. Fix it under **Manage deployments → Edit**, new version. |
| Opening the URL says "Script function not found: doGet" | The code wasn't pasted/saved, or you didn't deploy a **New version** after editing. |
| Console says saving failed and **no** rows appear | Wrong or old URL in `config.js`, or script not authorised (step 4), or the code was edited without redeploying a new version. |
| Console says *"refused by the server"* | The script rejected the request. Usually the script and the survey are on different schema versions: paste the current `Code.gs` and redeploy a **New version**. |
| A row went to a tab called `Responses_schema_3` | The header row in `Responses` doesn't match what the script expects (someone edited it). Clear the tab to start fresh, or keep working in the new tab. |
| Rows appear but columns look shifted | Don't edit or reorder the header. Delete the tab's contents and let the script recreate the header. |
