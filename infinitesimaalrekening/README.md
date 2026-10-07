# Infinitesimaalrekening — Workbook, chapters 0–7 (Blok 1)

**PDF:** [`pdf/Infi-workbook-ch0-7.pdf`](pdf/Infi-workbook-ch0-7.pdf) (62 pages, Haese-style layout)

Dictaat: S. Wepster, *Infinitesimaalrekening*, editie 2026, Mathematisch Instituut, Universiteit
Utrecht — Blok 1, Hoofdstuk 0–7 (pages 17–113).

Each section follows the cycle: minimal theory in the dictaat's own definitions, theorems and
strategies, immediately followed by the dictaat's exercises on it. About half of the exercises
(one per technique) are worked in full in the text; every other Oefening is listed in a NOW YOU
box and solved in Appendix S. All 212 exercises of chapters 0–7 are covered, including the
(Extra) ones.

| Chapter | Content | Exercises |
|---|---|---|
| 0 Voorkennis | algebra, functions and inverses, polynomials, trig, logarithms | 1–30 |
| 1 Complex numbers | $\mathbb C$, modulus/argument, calculations, $e^{i\varphi}$, $z^n=w$ | 101–123 |
| 2 Limits, differentiation, integration | limits and rules, squeeze, derivative as limit, integration rules | 201–220 |
| 3 Approximating functions | linearisation, Taylor polynomials, l'Hôpital, standard limits | 301–330 |
| 4 Tapas | Pascal, logarithmic differentiation, arcsin/arccos/arctan, sinh/cosh | 401–420 |
| 5 Differential equations | separation, integrating factor, variation of constants, initial values | 501–524 |
| 6 Primitives | parts, substitution, partial fractions, improper integrals, mixed | 601–635 |
| 7 More exercises | mixed problems, (Extra) function investigation | 701–730 |

Computational answers were checked with sympy.

## Build

```
./build.sh        # builds the PDF into pdf/
```

Sources in `src/`: `haese.sty` (layout, shared with the Bewijzen workbook), `infi.tex` (main),
`ifront.tex`, `i0.tex`–`i7.tex` (chapters), `isol0.tex`–`isol7.tex` (Appendix S).
