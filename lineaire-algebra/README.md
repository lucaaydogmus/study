# Lineaire Algebra (WISB107/108) — Hoofdstuk 1 t/m 4

Study guide built **only from the lecture notes (HC aantekeningen, weeks 1–4)**.
The dictaat (Beukers, *Lineaire Algebra*, 2026 edition) is used purely as a
reference: every definition/theorem below is tagged with its dictaat number so
you can look it up.

| Week | Notes cover | Dictaat sections | File |
|------|-------------|------------------|------|
| 1 | Vectors, lines, planes, inner product, plane equation | H1 (1.1–1.4), H2 (2.1–2.3, 2.5) | [week1](week1-H1-H2-vectoren-en-inproduct.md) |
| 2 | Matrices, matrix product, Gauss–Jordan, pivots | §3.1, §3.2 | [week2](week2-H3.1-3.2-matrices-en-gauss-jordan.md) |
| 3 | n×n systems, inverse matrix, subspaces, span, S_hom / S_inhom | §3.3, §3.4, §3.5 | [week3](week3-H3.3-3.5-inverse-deelruimten-oplossingsverzameling.md) |
| 4 | Linear combination, (in)dependence, relations, rank, dimension, basis | §4.1, §4.2 | [week4](week4-H4.1-4.2-afhankelijkheid-rang-basis.md) |

Not covered by the notes (and therefore not taught here): §2.4 worked examples,
§2.6, §3.6, §3.7, §4.3 (rang van een matrix), §4.4 (somruimte). They are in the
dictaat if you need them.

## How the four weeks fit together (the big picture)

1. **Week 1** gives you the objects: vectors in $\mathbb{R}^n$, and two ways to
   describe lines/planes (parametrisation vs. equation). The inner product is
   the bridge between the two.
2. **Week 2** turns "solve a linear system" into a mechanical algorithm on a
   matrix (Gauss–Jordan). The output tells you: no solution / one solution /
   infinitely many, via **pivots**.
3. **Week 3** specialises to square systems: $n$ pivots $\iff$ invertible
   $\iff$ unique solution for every right-hand side. Then it looks at the
   *shape* of solution sets: subspaces, span, and "inhomogeneous = particular +
   homogeneous".
4. **Week 4** asks: how many vectors do you *really* need to span a subspace?
   Answer: a basis; its size is the dimension. Finding dependencies is again
   Gauss–Jordan on $A\lambda = 0$.

Each file ends with the "slide questions" from the lectures, with worked answers.
