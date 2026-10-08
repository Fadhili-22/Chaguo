# 02 - Cleaning, RIASEC scores and major profiling

Code: `notebooks/02_cleaning.ipynb` (rerun top to bottom). Seed 42 is set (nothing random is used).
Outputs: `processed/riasec_clean.csv` (41,947 rows x 63 columns) and `processed/major_counts.csv` (5,551 rows).
The original `data.csv` was not modified (its SHA-256 checksum is the same before and after the run). Nothing was uploaded.
Not done, by your instruction: grouping majors into clusters, train/test split, any model.

## Data source & terms

- **Source:** Open Psychometrics raw-data page, RIASEC test data (file `RIASEC_data12Dec2018`, collected 2015-2018,
  downloaded by the project owner).
- **Terms, as read by the project owner from the site:** the data is anonymous, participants consented to research
  use, and the RIASEC test uses public-domain items from the Interest Item Pool. There is **no formal license**.
  (The dataset's own `codebook.txt` states no license or citation. The terms were confirmed by reading the
  Open Psychometrics raw-data page directly (Oct 2026). The project owner is saving a copy of it.)
- **Use here:** a non-commercial, educational capstone. Record the download date and keep the saved copy of the
  page with the project documentation. Cite Open Psychometrics (openpsychometrics.org) as the source.
- The codebook's only citation is for the TIPI questionnaire (Gosling, Rentfrow & Swann, 2003); TIPI columns are not used here.

## 1. Codebook checks

| Question | Answer (from `codebook.txt`) |
|---|---|
| What is `uniqueNetworkLocation`? | A **yes/no flag, not an ID**: `1` = the only record from that network in the dataset, `2` = more than one record (shared networks such as a school, or test retakes). Values in the data: 1 = 100,727 rows, 2 = 45,101. So we cannot group by network; we add `test_eligible` instead. |
| Fake words | `VCL6` (cuivocal), `VCL9` (florted), `VCL12` (verdid). 1 = ticked. |
| `education` codes | 1 = less than high school, 2 = high school, **3 = university degree, 4 = graduate degree**. The value 0 (1,125 rows) is not documented; it is treated as no answer and is removed by filter b. |

## 2. Filter funnel (applied in this order)

| Step | Rows remaining | Rows removed | % of original |
|---|---|---|---|
| 0. Original file | 145,828 | n/a | 100.0% |
| a. Age 18-100 | 108,217 | 37,611 | 74.2% |
| b. Education = university or graduate degree (3 or 4) | 59,125 | 49,092 | 40.5% |
| c. Passed fake-word check (no fake word ticked) | 46,490 | 12,635 | 31.9% |
| d. All 48 RIASEC items answered (0 = missing) | 43,602 | 2,888 | 29.9% |
| e. Major present and not a placeholder | 41,950 | 1,652 | 28.8% |
| f. Exact duplicates removed | **41,947** | 3 | **28.8%** |

**Final: 41,947 rows (28.8% of the original).** This is lower than the 61,399 estimate in report 01, because that
estimate did not include the degree-holders-only filter.

Notes on each step:
- **a.** 92 impossible ages (over 100) were removed here, together with everyone under 18.
- **b.** This is the biggest cut. It was applied before the fake-word check, as you specified; the order does not change the final set.
- **e. Placeholder list.** Normalised major (lowercase, apostrophes dropped, other punctuation turned into spaces)
  equal to: `no, none, na, n a (from "N/A"), nothing, nil, null, nope, nan, yes, n, x, xx, xxx, undecided, undeclared, unknown, idk,
  dont know, not sure, unsure, test`. Plus three rules: empty or punctuation-only (e.g. "-", "..."), a single character,
  digits only. Only these actually occurred: empty/punctuation-only 1,540; "no" 55; "undecided" 16; "yes" 10;
  "none" 7; "n a" 7; "na" 4; "undeclared" 2; single letters "l" 2, "p" 1, "e" 1; and one each of "xx", "unknown", "unsure",
  "55", "not sure", "idk", "dont know".
  Deliberately **kept**: "aa" (3 rows; may be the degree Associate of Arts), "general" (22), "other" (2): ambiguous, so flagged rather than removed.
- **f.** Duplicates are matched on the 48 items + age + *normalised* major, keeping the first copy. Only 3 were found
  (also 3 with the raw major). Exact duplicates are rare here, so most leakage risk comes from shared networks (step 4), not from copies.

## 3. RIASEC scale scores

Each score is the **mean of its 8 items** (range 1-5), saved as `R_score` ... `C_score`.

| Scale | Mean | Std | Min | 25% | Median | 75% | Max |
|---|---|---|---|---|---|---|---|
| R | 2.104 | 0.860 | 1.0 | 1.375 | 2.000 | 2.750 | 5.0 |
| I | 3.039 | 1.010 | 1.0 | 2.250 | 3.125 | 3.875 | 5.0 |
| A | 2.984 | 0.964 | 1.0 | 2.250 | 3.000 | 3.750 | 5.0 |
| S | 3.402 | 0.851 | 1.0 | 2.875 | 3.500 | 4.000 | 5.0 |
| E | 2.536 | 0.856 | 1.0 | 1.875 | 2.500 | 3.125 | 5.0 |
| C | 2.417 | 0.964 | 1.0 | 1.625 | 2.375 | 3.125 | 5.0 |

People in this sample (degree holders) rate Social highest and Realistic lowest on average.

**Correlation matrix (Pearson, n = 41,947):**

| | R | I | A | S | E | C |
|---|---|---|---|---|---|---|
| R | 1.000 | 0.332 | 0.174 | 0.037 | 0.296 | 0.457 |
| I | 0.332 | 1.000 | 0.330 | 0.126 | 0.009 | 0.053 |
| A | 0.174 | 0.330 | 1.000 | 0.281 | 0.251 | -0.068 |
| S | 0.037 | 0.126 | 0.281 | 1.000 | 0.351 | 0.111 |
| E | 0.296 | 0.009 | 0.251 | 0.351 | 1.000 | 0.447 |
| C | 0.457 | 0.053 | -0.068 | 0.111 | 0.447 | 1.000 |

**Does it show Holland's hexagon (R-I-A-S-E-C in a circle)? Yes.** Mean correlation by distance around the hexagon:

| Hexagon distance | Pairs | Mean r |
|---|---|---|
| 1 (neighbours: RI, IA, AS, SE, EC, RC) | 6 | **0.366** |
| 2 (RA, IS, AE, SC, RE, IC) | 6 | 0.169 |
| 3 (opposites: RS, IE, AC) | 3 | **-0.007** |

Neighbours correlate most (R-I 0.33, S-E 0.35, as you predicted, plus R-C 0.46 and E-C 0.45), and opposites are about zero (R-S 0.04, I-E 0.01, A-C -0.07).
So the data behaves as the theory says, which is a good sanity check for the defense. Two caveats: the pattern is not perfectly clean
(R-E at distance 2, r = 0.30, is higher than A-S at distance 1, r = 0.28), and most correlations are positive, which is typical when some people
simply rate everything higher.

## 4. Test-set eligibility (no split made)

`uniqueNetworkLocation` is a flag, so I added `test_eligible` (True only when the flag is 1). No `group_id` is possible.

- **Test-eligible: 34,657 rows (82.6%)**; not eligible: 7,290 (17.4%).
- The flag was computed on the **full original file** (145,828 rows), which is stricter than checking within the cleaned data: a row
  that looks alone after filtering but shared a network with someone we removed is still marked not eligible.
- The 7,290 non-eligible rows can still be used for training; they are only kept out of the test set so one household, school or retaker does not appear on both sides.

## 5. Major profiling (observations only; nothing merged)

Normalisation rule: lowercase, drop apostrophes, turn all other punctuation into spaces, collapse repeated spaces, trim.
The 41,947 clean rows contain **5,551 distinct normalised majors**; **4,102 of them appear only once**.
The full list with counts and cumulative % is in `processed/major_counts.csv`; the top 300 are printed in the notebook (section 5).

**Top 20:** psychology 6,422 (15.3%); business 1,656; english 1,470; education 1,104; biology 852; economics 723; accounting 602;
computer science 602; engineering 588; nursing 585; law 574; sociology 565; history 543; marketing 498; management 480; finance 445;
business administration 424; mechanical engineering 421; counseling 419; civil engineering 387.

**Coverage curve:**

| Top N majors | Rows covered | % of rows |
|---|---|---|
| 10 | 14,604 | 34.8% |
| 25 | 21,089 | 50.3% |
| 50 | 26,186 | 62.4% |
| 100 | 29,743 | 70.9% |
| 200 | 32,568 | 77.6% |
| 300 | 33,886 | 80.8% |
| 500 | 35,329 | 84.2% |
| 1,000 | 36,947 | 88.1% |
| 2,000 | 38,396 | 91.5% |

How to read it: mapping the top 300 by hand covers about 81% of rows, the top 500 about 84%. After that the curve flattens
(1,000 strings = 88%), and 4,102 strings are one-offs, so the last 10-15% is a long tail you would handle with keyword rules or leave unmapped. That is a decision for the next step.
Also: 99 majors have 50 or more rows and 56 have 100 or more, which matters for how many classes a classifier can learn from.

**Variant families (observations; patterns are loose and can overlap, e.g. "biomedical engineering" matches both biology and engineering):**

| Family | Distinct strings | Rows | Examples |
|---|---|---|---|
| computer science | 54 | 703 (1.7%) | computer science 602, computer science engineering 17, computer sciences 8, **cs 8**, **comp sci 5**, computing science 4, "computer sciense" 2 |
| information tech / systems | 21 | 340 (0.8%) | information technology 147, **it 123**, information systems 25, mis 11, ict 6, i t 5, cis 2 |
| psychology | 248 | 6,926 (16.5%) | psychology 6,422, "psycology" 22, **psych** 22, "psycholgy" 13, psychology and sociology 18, psychology counseling 13 |
| business | 172 | 2,828 (6.7%) | business 1,656, business administration 424, business management 314, **mba** 76, business admin 41, **bba** 16 |
| nursing | 49 | 649 (1.5%) | nursing 585, nurse 5, "nursin" 2, pre nursing 2, veterinary nursing 2 |
| education / teaching | 80 | 1,402 (3.3%) | education 1,104, teaching 94, elementary education 66, educational psychology 14 |
| english | 140 | 1,772 (4.2%) | english 1,470, english literature 61, english education 23, english lit 10 |
| accounting | 38 | 734 (1.7%) | accounting 602, accountancy 48, accounting and finance 20, **cpa** 14 |
| law | 47 | 652 (1.6%) | law 574, legal studies 16, pre law 8, law enforcement 6 (not the same field), lawyer 3 |
| engineering | 357 | 3,063 (7.3%) | engineering 588, mechanical 421, civil 387, electrical 293, chemical 228, computer 129 |

Other things worth knowing before mapping:
- **Typos and abbreviations** are present but modest in size (cs, comp sci, psych, mba, bba, cpa, mis, ict, econ).
- **Ambiguous strings:** "it" (123 rows: information technology, or a stray word?), "ba" (7), "aa" (3).
- **Multiple majors in one string:** 2,899 rows (6.9%) contain a comma, "/", "&", "+", ";" or "and" (e.g. "Business & Criminal Justice", "psychology and counseling"). You will need a rule (first listed? both?).
- **Broad or vague majors, kept as is:** business 1,656, education 1,104, engineering 588, science 221, art 208, liberal arts 120, social science 113, general studies 97, arts 82, health 57, humanities 50, general 22.
- **Not English:** 18 strings contain non-English characters.
- **Class imbalance:** psychology alone is 15.3% of rows (16.5% with variants), so a model that always guessed psychology would already be right about 1 time in 7. Keep this in mind when you judge accuracy, and see the note on stratifying below.

## Decisions & justification (for the defense)

| Decision | Why |
|---|---|
| **18+ for training** | The labels should be fields people actually chose; app users can be any age. (The model is trained on adults' choices and applied to younger students; say so openly, and that this means it is an extrapolation.) Removing impossible ages (over 100) is plain error removal. |
| **Degree holders only** (education 3 or 4) | Labels are completed or ongoing study, not intentions. Costs about 49,000 rows (the largest cut), but the label is much more trustworthy. |
| **Fake-word filter** | Anyone who says they know "cuivocal", "florted" or "verdid" is not reading carefully, so their other answers are less reliable. It removes careless respondents (12,635 rows at that point). |
| **Drop incomplete rows** | The dataset is large enough (43,602 rows at that point), and dropping avoids inventing answers by imputation. The undocumented `0` code is treated as "no answer". |
| **Remove exact duplicates + unique-network test set** | Prevents leakage and inflated test scores: identical rows or people from the same household or school (or retakes) on both sides of the split would let the model look better than it is. Only 3 exact duplicates existed, but 17.4% of rows share a network, which is why the test-eligible flag matters. |
| **Scale score = mean of 8 items** | Keeps scores on the original 1-5 scale and comparable across scales. |

## Open points for your review

1. **Stratification:** `test_eligible` is only a flag, so the split must (a) draw the test set only from `test_eligible == True`, and (b) stratify by cluster once clusters exist. Rare clusters could end up with very few test rows; check this when you choose the clusters.
2. **Multi-major strings (6.9%)** and the ambiguous strings ("it", "ba", "aa", "general", "other"): decide a rule before mapping.
3. **Age gap:** training is on adults (median age 29); your app's users are KCSE students aged about 17-19. Worth a limitation in the defense, and worth checking whether results change for the younger part of the clean data (18-22).
4. **Kenya:** only 137 clean rows are from Kenya (country code KE), and 67% of clean rows are female (gender code 2). Treat this as a prototype, not validated for Kenyan students.
5. **Kenyan course names** (KUCCPS-style clusters) will differ from US/UK major names; the mapping step has to bridge this.
