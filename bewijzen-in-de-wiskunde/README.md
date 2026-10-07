# Bewijzen in de Wiskunde — study material

## Main document: Workbook, chapters 0–5

**PDF:** [`pdf/BiW-workbook-ch0-5.pdf`](pdf/BiW-workbook-ch0-5.pdf) (71 pages, Haese-style layout)

Book: C. Newstead, *An Infinite Descent into Pure Mathematics*, Utrecht adaptation
(29 July 2026).

| Part | Status | Content |
|---|---|---|
| Chapters 0, 1, 2 (to Def. 2.2.46) | **built from the book pages** | Minimal theory in the book's own words and numbers, each piece followed by the book's exercises on it. Essential ★ and recommended ☆ exercises (per the planning) worked in the text; every other exercise in those pages solved in Appendix S. |
| Rest of §2.2, 2.E, chapters 3, 4, 5 | provisional (book pages not uploaded yet) | Theory, Level 1 and book-level worked examples, stretch exercises (solutions in Appendix T), one-page proof toolbox (Appendix U). Numbering and examples not verified against the Utrecht edition; a red notice at the start of chapter 3 says so. |

Upload book pages 94–180 and chapters 3–5 will be rebuilt the same way as chapters 0–2.

## Older document

[`pdf/BiW-study-guide-ch0-5.pdf`](pdf/BiW-study-guide-ch0-5.pdf): the earlier 58-page guide written without the book; fully superseded by the workbook.

## Build

```
./build.sh        # builds both PDFs into pdf/
```

Sources in `src/`: `haese.sty` (layout); workbook `wb05.tex` (main), `wfront05.tex`, `w0.tex`,
`w1a.tex`, `w1b.tex`, `w2.tex`, `wsol.tex` (chapters 0–2 from the book), `m3.tex`, `m4.tex`,
`m5.tex` with `lvl3.tex`–`lvl5.tex`, `msol345.tex`, `mtoolbox.tex` (chapters 3–5, provisional).
