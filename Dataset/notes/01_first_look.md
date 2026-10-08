# 01 - First look: Open Psychometrics RIASEC dataset (12 Dec 2018)

Code: `notebooks/01_first_look.ipynb` (rerun top to bottom). Read-only: the original files were not modified,
nothing was uploaded, and nothing was written to `processed/`.

## 1. Inventory

| File | Size | Notes |
|---|---|---|
| `RIASEC_data12Dec2018/data.csv` | 29.3 MB | 145,828 rows x 94 columns (see "stray column" below) |
| `RIASEC_data12Dec2018/codebook.txt` | 6 KB | Read in full |
| `RIASEC_data12Dec2018/.~lock.data.csv#` | 71 B | LibreOffice lock file: `data.csv` was open in LibreOffice when it was packaged. Harmless, but don't save over `data.csv` from a spreadsheet. |

**Delimiter: TAB** (header has 93 tabs, 0 commas), despite the `.csv` name. Use `pd.read_csv(..., sep="\t")`.
I read every column as text first (`dtype=str, keep_default_na=False`) so that blanks and strings like "NA" are not silently converted.

Collected 2015-2018 from visitors to an online RIASEC / Holland Code test who agreed to an extra research survey.
The codebook warns the data "may require significant cleaning".

| Column group | Columns | Meaning |
|---|---|---|
| RIASEC items | 48 (`R1`-`R8`, `I1`-`I8`, `A1`-`A8`, `S1`-`S8`, `E1`-`E8`, `C1`-`C8`) | "How much would you like to do this task", 1=Dislike, 3=Neutral, 5=Enjoy. **Raw items only; no scale scores are included.** You compute each scale from its 8 items. |
| Timing | `introelapse`, `testelapse`, `surveyelapse` | Seconds spent on each page (server side) |
| TIPI | `TIPI1`-`TIPI10` | Ten-Item Personality Inventory (Big Five), 1-7 |
| Vocabulary check | `VCL1`-`VCL16` | Words the person claims to know (1=checked). `VCL6`, `VCL9`, `VCL12` are fake words = validity check |
| Demographics | `education`, `urban`, `gender`, `engnat`, `age`, `hand`, `religion`, `orientation`, `race`, `voted`, `married`, `familysize` | Self-reported |
| Field of study | `major` | Free text: "If you attended a university, what was your major?" |
| Technical | `uniqueNetworkLocation`, `country`, `source` | `country` is from the network (IP) location |

Stray column: one row has an extra tab, which created an
unnamed 94th column. It is one malformed row; the major still sits in the right place for 145,827 rows. I ignored the column.

## 2. License / terms

I searched every text file for license, copyright, permission, citation and "creative commons" wording.
**Nothing is stated in the files.** The only citation-like text is for the TIPI questionnaire (Gosling et al., 2003),
not for the dataset. I can't tell you whether use in an educational capstone is allowed based on these files,
and I haven't verified the terms on the website. Check the download page on openpsychometrics.org
(the `_rawdata` page), screenshot or copy the terms for your report, and cite the source and the date you
downloaded it. If nothing is stated there either, email the site owner.

## 3. The `major` column

It exists.

| | Rows | % of 145,828 |
|---|---|---|
| Filled (non-blank) | 93,626 | 64.2% |
| Empty / blank | 52,202 | 35.8% |

Filled does not mean usable: 1,752 filled values are placeholders such as "no", "N/A", "none". There are
15,957 distinct raw strings, which fall to 11,816 after just trimming spaces and lowercasing.

**Top 50 raw values** (shown exactly as typed, with quotes so spaces and case are visible):

| # | raw value | n | | # | raw value | n |
|---|---|---|---|---|---|---|
| 1 | 'psychology' | 6,861 | | 26 | 'Criminal Justice' | 477 |
| 2 | 'Psychology' | 5,763 | | 27 | 'Management' | 443 |
| 3 | 'English' | 2,342 | | 28 | 'accounting' | 437 |
| 4 | 'Business' | 2,290 | | 29 | 'Medicine' | 420 |
| 5 | 'Biology' | 1,289 | | 30 | 'law' | 400 |
| 6 | 'Nursing' | 1,275 | | 31 | 'Communications' | 394 |
| 7 | 'business' | 1,166 | | 32 | 'computer science' | 365 |
| 8 | 'Education' | 1,162 | | 33 | 'Political Science' | 351 |
| 9 | 'nursing' | 839 | | 34 | 'no' | 350 |
| 10 | 'Psychology ' | 821 | | 35 | 'Business Management' | 337 |
| 11 | 'engineering' | 773 | | 36 | 'N/A' | 336 |
| 12 | 'Economics' | 730 | | 37 | 'Chemistry' | 331 |
| 13 | 'Accounting' | 730 | | 38 | 'Music' | 319 |
| 14 | 'civil engineering' | 675 | | 39 | 'Social Work' | 319 |
| 15 | 'Law' | 667 | | 40 | 'Counseling' | 317 |
| 16 | 'biology' | 655 | | 41 | 'Science' | 309 |
| 17 | 'english' | 649 | | 42 | 'Art' | 304 |
| 18 | 'Computer Science' | 643 | | 43 | 'Mathematics' | 304 |
| 19 | 'History' | 631 | | 44 | 'sociology' | 301 |
| 20 | 'education' | 607 | | 45 | 'Communication' | 293 |
| 21 | 'Marketing' | 571 | | 46 | 'medicine' | 292 |
| 22 | 'Engineering' | 555 | | 47 | 'economics' | 291 |
| 23 | 'Finance' | 532 | | 48 | 'management' | 288 |
| 24 | 'Sociology' | 530 | | 49 | 'Mechanical Engineering' | 287 |
| 25 | 'Business Administration' | 481 | | 50 | 'Physics' | 282 |

What the list shows: case variants ("psychology" / "Psychology"),
trailing spaces, vague values ("Science", "Engineering", "Business"), placeholders ("no", "N/A"), and overlap between
neighbours ("Communication" / "Communications", "Business" / "Business Management" / "Business Administration").
Abbreviations exist but are rare (after trimming and lowercasing: "it" 234, "psych" 52, "bba" 30, "econ" 17,
"cs" 15, "bio" 13, "cis" 8, "comp sci" 7); note "it" is ambiguous (information technology, or a stray word). Only 50 of
15,957 raw values are shown here.

**Cross-check with `education`:**

| education | Rows | With major | % with major |
|---|---|---|---|
| 0 no answer | 1,125 | 574 | 51.0% |
| 1 less than high school | 22,665 | 5,572 | 24.6% |
| 2 high school | 62,625 | 30,227 | 48.3% |
| 3 university degree | 39,102 | 38,066 | 97.4% |
| 4 graduate degree | 20,311 | 19,187 | 94.5% |

- **96.4%** of university-level respondents (59,413) filled in a major.
- But **38.8%** of all filled majors (36,373) come from people whose education is *below* a degree. Most are
  probably current university students or school pupils naming an intended major; I haven't verified this.
  Their major is not a completed field of study, so decide whether to keep them.

## 4. Data quality

**RIASEC items.** All 48 items are numeric. There are no codes above 5 or below 0, but **the value `0` appears in
21,435 cells** (codebook documents 1-5 only). I treat 0 as "no answer". 10,064 rows (6.9%) have at least one 0;
135,764 rows have all 48 items in 1-5. Value counts: 1 = 2,026,975, 2 = 1,229,897, 3 = 1,474,708, 4 = 1,301,851,
5 = 944,878.

**Validity check** (ticked at least one of the fake words `VCL6`, `VCL9`, `VCL12`): **29,285 rows fail (20.1%)**.
By word: VCL6 12,133, VCL9 8,510, VCL12 17,937. All three ticked: 1,973.

**Age** (min 13, median 21): no row is under 13, as the codebook says. But the max is 2,147,483,647 and values like
2015, 9001 and 1,000,000 appear.

| Age band | Rows | % |
|---|---|---|
| 13-17 | 37,519 | 25.7% |
| 18-24 | 52,172 | 35.8% |
| 25-34 | 26,901 | 18.4% |
| 35-49 | 19,669 | 13.5% |
| 50-79 | 9,455 | 6.5% |
| 80-99 | 15 | 0.0% |
| 100 or more (impossible) | 90 | 0.1% |

92 rows have age > 100 (impossible). I used 18-100 as "adult" in step 5.

**Countries.** Top 10: US 80,579 (55.3%), MY 7,841 (5.4%), CA 7,256 (5.0%), SG 5,769 (4.0%), GB 5,533 (3.8%),
AU 5,524 (3.8%), PH 4,848 (3.3%), IN 2,216 (1.5%), NONE (unknown) 1,846 (1.3%), NZ 1,558 (1.1%).

- **Kenya: 731 rows (0.5%).**
- **All African countries: 2,046 rows (1.4%)**: South Africa 745, Kenya 731, Egypt 135, Nigeria 86, Ghana 54, Morocco 53.
- Other East Africa: Uganda 25, Ethiopia 10, Tanzania 9, Rwanda 1.

Transfer to Kenya: the sample is heavily American, English-speaking and young. Kenyan rows are too few to
train or validate on separately (see step 5: only 233 survive filtering).

## 5. Usable sample estimate

| Filter added (cumulative) | Rows left | % of all |
|---|---|---|
| All rows | 145,828 | 100.0% |
| + adult (18-100) | 108,217 | 74.2% |
| + passed validity check | 85,876 | 58.9% |
| + complete RIASEC items (all 48 in 1-5) | 80,349 | 55.1% |
| + non-empty major | **61,399** | **42.1%** |

Further cuts of the 61,399 (not applied; for your decisions):
- Excluding placeholder majors ("no", "N/A", ...): 60,888.
- Only university-level education (3 or 4): 41,990 (when it is also restricted to non-placeholder majors).
- Kenya: **233** rows; any African country: **816**.
- Distinct majors after trimming and lowercasing: **7,903** (so a classifier cannot predict raw majors; you must group
  them first, which I have not started).
- Rows with a shared or retaken network location (`uniqueNetworkLocation` = 2): 12,535. These may be classroom
  groups or the same person retaking the test, so splitting train and test randomly could leak near-duplicates.

## Verdict

**Usable as a prototype training set, with significant caveats, once the licence is confirmed.** ~61,000 rows
with complete RIASEC items and a major is a realistic training size, and the dataset has what the brief needs:
RIASEC items, a validity check, education, age, country and a major.

Main risks:
1. **Licence is unknown.** Nothing in the files. Confirm on the website before building on it.
2. **`major` is messy free text:** 15,957 distinct strings, placeholders, and vague entries ("Science"). Grouping it
   into course clusters will be the main effort and the biggest source of label noise. Do it carefully and
   document every mapping rule.
3. **Labels are what people studied, not what suits them.** The model learns "RIASEC profile -> major people
   chose", including social pressure, not "best fit". Weak signal is expected: RIASEC explains only part of
   major choice, and several majors share similar profiles. Plan on modest accuracy and report top-k accuracy
   (your top-5 design suits this).
4. **Poor representation of Kenya.** Kenya is 0.5% of rows and 233 after filtering; 55% of respondents are from
   the US. Treat results as not validated for Kenyan students, and say so in your defence. Kenyan course
   names (KUCCPS clusters) differ from US majors.
5. **Item mismatch.** The data has the 48 specific items from this test. Your app must ask the same items (or
   you must map your own test's scores onto the same scale); otherwise the model's inputs won't mean the same thing.
   Also note there are no ready-made scale scores: compute them from the 8 items per scale.
6. **Age filter vs KCSE audience.** KCSE students are mostly 17-19. Adult-only (18+) leaves out all 17-year-olds, and
   13-17 is 25.7% of the data. Whether to use minors' data is an ethics and supervisor decision.
7. **Selection bias.** People who took an online test and agreed to a survey; 20% failed the validity check
   (after filtering, results are for the careful respondents only), and the group skews young and female
   (about 65% female by the `gender` codes).
8. **Cleaning needed:** the stray malformed row, impossible ages (92 rows), the undocumented `0` item code,
   `education` 0 and `gender` 0 codes, `country` = "NONE", and placeholder majors.

Next step, after you review this: decide the filters (age, education, 0-handling) and then start the major grouping.
