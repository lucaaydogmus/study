# Bewijzen in de Wiskunde — Study guide, chapters 0–5

Theory-focused study guide for the first half of *Bewijzen in de Wiskunde* (2026–2027),
built around the **essential** and **recommended** exercises of the course planning.
Book: C. Newstead, *An Infinite Descent into Pure Mathematics* (section and exercise
numbers in the guide refer to that book).

**PDF:** [`pdf/BiW-study-guide-ch0-5.pdf`](pdf/BiW-study-guide-ch0-5.pdf) (58 pages, A4)

| Guide chapter | Book sections | Planning | Quiz |
|---|---|---|---|
| 0 Getting started: numbers | Ch. 0 (number sets, bases, division, irrationals), A.1 | Mon 7 Sep | Quiz 1 (23 Sep) |
| 1 Logical structure | §1.1, §1.2, §1.3 | 14 & 16 Sep | Quiz 1 (§1.1) |
| 2 Sets | §2.1, §2.2 | 21 & 23 Sep | Quiz 2 (7 Oct) |
| 3 Functions | §3.1, §3.2 | 23 & 28 Sep | Quiz 2 (7 Oct) |
| 4 Mathematical induction | §4.2, §4.3 | 30 Sep & 5 Oct | — |
| 5 Relations | §5.1, §5.2 | 7 Oct | Quiz 3 (21 Oct) |
| Appendix T | One-page proof toolbox | — | — |
| Appendix S | Solutions to the stretch exercises | — | — |

Each chapter climbs three levels: **Level 1** worked examples (one proof shape at a
time, quiz style), **Level 2 "book level"** examples at the difficulty of the hardest
essential/recommended exercises, each with its invention step named, and **stretch
exercises** with hints and full solutions in Appendix S.

Layout follows the Haese Mathematics textbook style: lettered sections, yellow
definition boxes, blue theorem boxes, green proof-strategy templates,
“Example n | Self Tutor” worked examples, purple exercise-target boxes listing the
planning's essential/recommended numbers, and red “Watch out” boxes.

## Build

```
./build.sh        # pdflatex twice; sources in src/, output in pdf/
```

Sources: `src/guide.tex` (main), `src/haese.sty` (layout), `src/front.tex`,
`src/ch0.tex` … `src/ch5.tex` (theory and Level 1), `src/lvl0.tex` … `src/lvl5.tex` (book-level examples and stretch exercises), `src/toolbox.tex`, `src/solutions.tex`.
