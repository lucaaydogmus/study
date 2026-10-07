# Bewijzen in de Wiskunde — study material

## Main document: Workbook, chapters 0–5

**PDF:** [`pdf/BiW-workbook-ch0-5.pdf`](pdf/BiW-workbook-ch0-5.pdf) (93 pages, Haese-style layout)

Book: C. Newstead, *An Infinite Descent into Pure Mathematics*, Utrecht adaptation
(29 July 2026), pages 1–180 (chapters 0–5 including the chapter exercises 0.E–5.E).

Every section follows the same cycle: minimal theory in the book's own words and numbers
(definitions, strategies, results), immediately followed by the book's exercises on it.
Exercises flagged in the course planning (★ essential, ☆ recommended, bonus) are worked in
full in the text; every other book exercise (○) is listed in a NOW YOU box and solved in
Appendix S. Appendix T is a one-page proof toolbox.

| Chapter | Sections | Flagged exercises worked in the text |
|---|---|---|
| 0 Numbers | 0.1–0.4, 0.E | per planning |
| 1 Logical structure | 1.1–1.3, 1.E | per planning |
| 2 Sets | 2.1, 2.2 (incl. tuples, cartesian products), 2.E | 2.2.51, 2.2.53, 2.E.4–6, 16, 18, 28, 32, 33, 38, 41 |
| 3 Functions | 3.1, 3.2, 3.E | 3.1.8–41, 3.2.5–47, 3.E.2–48 (flagged ones) |
| 4 Induction | 4.1 (brief), 4.2, 4.3, 4.E | 4.2.5–20, 4.3.8–18, 4.E.10–35 (flagged ones) |
| 5 Relations | 5.1, 5.2, 5.E | 5.1.6–41, 5.2.24–36, 5.E.18, 22, 23 |

## Older document

[`pdf/BiW-study-guide-ch0-5.pdf`](pdf/BiW-study-guide-ch0-5.pdf): the earlier 58-page guide
written without the book; superseded by the workbook.

## Build

```
./build.sh        # builds both PDFs into pdf/
```

Sources in `src/`: `haese.sty` (layout); workbook `wb05.tex` (main), `wfront05.tex`,
`w0.tex`, `w1a.tex`, `w1b.tex`, `w2.tex`+`w2b.tex`, `w3.tex`, `w4.tex`, `w5.tex`,
`wsol.tex` with `sol2b.tex`–`sol5.tex` (Appendix S), `mtoolbox.tex` (Appendix T).
The older guide is `guide.tex` with `front.tex`, `ch0.tex`–`ch5.tex`, `lvl0.tex`–`lvl5.tex`,
`solutions.tex`, `toolbox.tex`.
