# Bewijzen in de Wiskunde — study material

Two documents, same Haese-style layout, built from the LaTeX sources in `src/`.

## 1. Workbook, chapters 0–2 (built from the book) — use this one

**PDF:** [`pdf/BiW-workbook-ch0-2-from-book.pdf`](pdf/BiW-workbook-ch0-2-from-book.pdf) (42 pages)

Built strictly from the uploaded pages of C. Newstead, *An Infinite Descent into
Pure Mathematics* (Utrecht adaptation, 29 July 2026): Chapter 0 with 0.E, Chapter 1
with 1.E, §2.1 and §2.2 up to Definition 2.2.46. Minimal theory (the book's own
definitions, strategies and results, with the book's numbers), each piece followed
immediately by the book's exercises on it. Every exercise in those pages is either
worked in the text (all essential ★ and recommended ☆ ones from the planning) or
solved in Appendix S. The rest of §2.2 (tuples, Cartesian products), 2.E and
chapters 3–5 were not in the upload and are not covered.

## 2. Study guide, chapters 0–5 (written without the book)

**PDF:** [`pdf/BiW-study-guide-ch0-5.pdf`](pdf/BiW-study-guide-ch0-5.pdf) (58 pages)

Written before the book was available, from the planning and memory of the standard
edition. Its chapters 0–2 are superseded by the workbook; its chapters 3–5 remain
useful as theory and practice but their numbering and examples are not checked
against the Utrecht edition.

| Guide chapter | Book sections | Planning |
|---|---|---|
| 3 Functions | §3.1, §3.2 | 23 & 28 Sep, Quiz 2 |
| 4 Mathematical induction | §4.2, §4.3 | 30 Sep & 5 Oct |
| 5 Relations | §5.1, §5.2 | 7 Oct, Quiz 3 |

## Build

```
./build.sh        # builds both PDFs into pdf/
```

Sources: `src/haese.sty` (layout); workbook `src/wb.tex`, `src/wfront.tex`, `src/w0.tex`,
`src/w1a.tex`, `src/w1b.tex`, `src/w2.tex`, `src/wsol.tex`; study guide `src/guide.tex`
and the files it inputs.
