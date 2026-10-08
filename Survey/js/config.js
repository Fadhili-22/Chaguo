/*
 * The only settings you edit. Plain globals, loaded before the other scripts.
 *
 * SURVEY_ENDPOINT  The Google Apps Script web app address (the long URL ending in /exec).
 *                  Leave it "" to turn saving off: snapshots are then printed to the browser
 *                  console (F12 -> Console) instead of being sent anywhere. See apps-script/SETUP.md.
 *
 * SEND_MODE        "cors" (default): the page reads Google's reply, so it knows whether a save worked.
 *                  "no-cors": the page cannot read the reply; a request that finishes without a
 *                  network error counts as saved. Only switch to this if, after deploying, the console
 *                  says saves failed but the rows DO appear in the Sheet (see SETUP.md, step 8).
 *
 * SURVEY_URL      Where the survey lives (used in the WhatsApp share text on the results screen).
 *
 * SURVEY_OPEN      true = the survey runs. Anything else (false) = the opening screen says the survey has
 *                  closed, and nothing is ever sent. Flip it to false, commit and push to close the survey.
 *
 * CONSENT_VERSION  A short label stored with every row. Change it whenever the wording on the
 *                  opening screen (what people agree to) changes, so each row says which wording
 *                  its respondent saw.
 */
var SURVEY_ENDPOINT = "https://script.google.com/macros/s/AKfycbxm27yuiGDxA4JmZf1dhrNEVZ63pBCrr7NzD6e3Jtp7jwxLHXyJVSbb1a8i2DVukNFZ/exec";
var SEND_MODE = "cors";
var SURVEY_URL = "https://fadhili-22.github.io/Chaguo/";
var SURVEY_OPEN = true;
var CONSENT_VERSION = "2026-10-v2";
