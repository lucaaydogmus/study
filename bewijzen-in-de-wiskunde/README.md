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

## Companion: Planning exercises worked step by step

**PDF:** [`pdf/BiW-planning-exercises-steps.pdf`](pdf/BiW-planning-exercises-steps.pdf) (86 pages)

Every exercise flagged ★ essential or ☆ recommended in the course planning for chapters 0–5
(189 exercise numbers, plus the bonus exercises 1.2.14, 2.E.18, 3.1.21), worked out in a fixed
format meant for comparing with your own attempt:

- **Given** — all assumptions, including the implicit ones (types of the variables, unfolded definitions);
- **To show** — the goal, rewritten in symbols, with its logical shape;
- **Plan** — the book strategy that fits the shape;
- **Step 1, Step 2, …** — one move per step, each with the definition, strategy, theorem or
  algebra rule that justifies it in grey brackets;
- **Conclusion** and a **Compare with your work** checklist (what a complete answer must contain,
  and the typical mistake for that exercise).

Only material from the book up to the exercise is used, and all numbers are the book's.

## Older document

[`pdf/BiW-study-guide-ch0-5.pdf`](pdf/BiW-study-guide-ch0-5.pdf): the earlier 58-page guide
written without the book; superseded by the workbook.

## Build

```
./build.sh        # builds all three PDFs into pdf/
```

Sources in `src/`: `haese.sty` (layout); workbook `wb05.tex` (main), `wfront05.tex`,
`w0.tex`, `w1a.tex`, `w1b.tex`, `w2.tex`+`w2b.tex`, `w3.tex`, `w4.tex`, `w5.tex`,
`wsol.tex` with `sol2b.tex`–`sol5.tex` (Appendix S), `mtoolbox.tex` (Appendix T).
Step-by-step companion: `wsteps.tex` (main, defines the Given/To show/Plan/Step macros), `sfront.tex`,
`s0.tex`, `s1.tex`+`s1b.tex`, `s2.tex`+`s2b.tex`, `s3.tex`+`s3b.tex`, `s4.tex`+`s4b.tex`, `s5.tex`.
The older guide is `guide.tex` with `front.tex`, `ch0.tex`–`ch5.tex`, `lvl0.tex`–`lvl5.tex`,
`solutions.tex`, `toolbox.tex`.
