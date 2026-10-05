# Week 4 — §4.1 & §4.2: Lineaire (on)afhankelijkheid, relaties, rang, dimensie en basis

> Lecture framing: last week we had $\mathrm{Span}(\mathbf{v}_1,\dots,\mathbf{v}_r)$. Today's
> question: **how do we find, by a method instead of "staren" (staring), the
> minimal number of vectors needed to span a subspace $W$?** That number is the
> **dimension**; such a minimal set is a **basis**.

---

## 0. The motivating example (VB in $\mathbb{R}^4$)

$$
W = \mathrm{Span}\!\left(
\begin{pmatrix}1\\1\\0\\0\end{pmatrix},
\begin{pmatrix}1\\1\\2\\0\end{pmatrix},
\begin{pmatrix}3\\3\\2\\0\end{pmatrix}\right).
$$

By "staring" we see
$$
\begin{pmatrix}3\\3\\2\\0\end{pmatrix} = 2\begin{pmatrix}1\\1\\0\\0\end{pmatrix} + \begin{pmatrix}1\\1\\2\\0\end{pmatrix},
\qquad\text{equivalently}\qquad
2\begin{pmatrix}1\\1\\0\\0\end{pmatrix} + \begin{pmatrix}1\\1\\2\\0\end{pmatrix} - \begin{pmatrix}3\\3\\2\\0\end{pmatrix} = \mathbf{0}.
$$

Vocabulary this gives us:
- the third vector is a **lineaire combinatie** of the first two; the three vectors are **afhankelijk**;
- the second equation is a **niet-triviale relatie** between the three vectors.

Hence $W = \mathrm{Span}\big((1,1,0,0)^t,(1,1,2,0)^t\big)$; those two are **onafhankelijk** — they form a **basis** of $W$ — and with fewer than two vectors $W$ cannot be spanned: **$\dim W = 2$**.

Topics of the week, in order: 1. lineaire combinatie, 2. lineair (on)afhankelijk, 3. lineaire relatie (triviaal / niet-triviaal) + *how to find relations*, 4. rang / dimensie, 5. basis, then the theorems of §4.2.

---

## 1. Definities (given $\mathbf{v}_1,\dots,\mathbf{v}_r\in\mathbb{R}^n$)

| # | Dictaat | Definition |
|---|---------|------------|
| 1 | §3.4 (3.4.3) | $\mathrm{Span}(\mathbf{v}_1,\dots,\mathbf{v}_r) = \{\lambda_1\mathbf{v}_1+\dots+\lambda_r\mathbf{v}_r \mid \lambda_i\in\mathbb{R}\}$ is the **opspansel** of $\mathbf{v}_1,\dots,\mathbf{v}_r$. |
| 2 | §4.1 (4.1.1) | $\lambda_1\mathbf{v}_1+\dots+\lambda_r\mathbf{v}_r$ ($\lambda_i\in\mathbb{R}$) is a **lineaire combinatie** of $\mathbf{v}_1,\dots,\mathbf{v}_r$. (These are exactly the elements of the span.) |
| 3 | §4.1 (4.1.1) | $\mathbf{w}\in\mathbb{R}^n$ is **lineair afhankelijk van** $\mathbf{v}_1,\dots,\mathbf{v}_r$ if there are $\lambda_i$ with $\mathbf{w} = \lambda_1\mathbf{v}_1+\dots+\lambda_r\mathbf{v}_r$. Equivalently: $\mathbf{w}\in\mathrm{Span}(\mathbf{v}_1,\dots,\mathbf{v}_r)$; equivalently: $\mathbf{w}$ can be written as a linear combination of them. |
| 4 | §4.1 (4.1.1) | The $r$-tuple $\mathbf{v}_1,\dots,\mathbf{v}_r$ is **lineair afhankelijk** if **at least one** $\mathbf{v}_i$ is linearly dependent on the other $r-1$ vectors. |
| 5 | §4.1 (4.1.1) | $\mathbf{v}_1,\dots,\mathbf{v}_r$ are **onafhankelijk** if they are not afhankelijk. |
| 6 | §4.1 (4.1.2) | An equation $\lambda_1\mathbf{v}_1+\dots+\lambda_r\mathbf{v}_r = \mathbf{0}$ is a **lineaire relatie** $(\lambda_1,\dots,\lambda_r)$. It is **triviaal** if all $\lambda_i = 0$; **niet-triviaal** if at least one $\lambda_i\neq0$. |

Examples from the lecture:
- $(3,3,2,0)^t$ is linearly dependent on $(1,1,0,0)^t$ and $(1,1,2,0)^t$ (def. 3).
- $\{(1,1,0,0)^t,(1,1,2,0)^t,(3,3,2,0)^t\}$ is an afhankelijk stel (def. 4).
- $\{(1,1,0,0)^t,(1,1,2,0)^t\}$ is an onafhankelijk stel: neither is a multiple of the other (def. 5).

The trivial relation always exists ($\lambda_i = 0$ for all $i$), so it carries no information. The interesting question is always: **is there a non-trivial relation?**

**Slide quiz.** Find $\lambda_1,\lambda_2,\lambda_3$ with $\lambda_1\mathbf{e}_1 + \lambda_2\mathbf{e}_2 + \lambda_3\mathbf{e}_3 = \mathbf{0}$ in $\mathbb{R}^3$.
"Met de hand": looking at each coordinate gives $\lambda_1 = \lambda_2 = \lambda_3 = 0$ — only the trivial relation, so $\mathbf{e}_1,\mathbf{e}_2,\mathbf{e}_3$ are independent. (The general method is below: use H3.)

---

## 2. Afhankelijk ⟺ niet-triviale relatie (Stelling 4.1.3 / 4.1.5)

**Conclusie 1 (⇒).** Suppose $\mathbf{v}_1,\dots,\mathbf{v}_r$ is dependent, say $\mathbf{v}_1 = \lambda_2\mathbf{v}_2 + \dots + \lambda_r\mathbf{v}_r$. Bring everything to one side:
$$
1\cdot\mathbf{v}_1 - \lambda_2\mathbf{v}_2 - \dots - \lambda_r\mathbf{v}_r = \mathbf{0},
$$
a relation with $\lambda_1 = 1\neq0$: **non-trivial**. So: *afhankelijk ⇒ there exists a non-trivial relation.*

**(⇐).** Suppose $\lambda_1\mathbf{v}_1 + \dots + \lambda_r\mathbf{v}_r = \mathbf{0}$ with not all $\lambda_i = 0$; say $\lambda_1\neq0$. Then
$\lambda_1\mathbf{v}_1 = -\lambda_2\mathbf{v}_2 - \dots - \lambda_r\mathbf{v}_r$, and because $\lambda_1\neq0$ we may divide:
$$
\mathbf{v}_1 = -\frac{\lambda_2}{\lambda_1}\mathbf{v}_2 - \dots - \frac{\lambda_r}{\lambda_1}\mathbf{v}_r,
$$
so $\mathbf{v}_1$ depends on $\mathbf{v}_2,\dots,\mathbf{v}_r$: the set is dependent.

**Conclusie 2 (Stelling 4.1.3).** $\mathbf{v}_1,\dots,\mathbf{v}_r$ afhankelijk $\iff$ there exists a **niet-triviale** relation between them.

**Conclusie 3 (Stelling 4.1.5).** $\mathbf{v}_1,\dots,\mathbf{v}_r$ onafhankelijk $\iff$ the **only** relation between them is the trivial one.

> Conclusie 3 is *the* test you use in practice: to prove independence, show that
> $\lambda_1\mathbf{v}_1 + \dots + \lambda_r\mathbf{v}_r = \mathbf{0}$ forces all $\lambda_i = 0$.

---

## 3. How do we *find* non-trivial relations? → Gauss–Jordan on $A\boldsymbol{\lambda} = \mathbf{0}$

**VB.** $\{(1,1,0,0)^t,(1,1,2,0)^t,(3,3,2,0)^t\}$. We look for $\lambda_1,\lambda_2,\lambda_3$ with
$$
\lambda_1\begin{pmatrix}1\\1\\0\\0\end{pmatrix} + \lambda_2\begin{pmatrix}1\\1\\2\\0\end{pmatrix} + \lambda_3\begin{pmatrix}3\\3\\2\\0\end{pmatrix} = \begin{pmatrix}0\\0\\0\\0\end{pmatrix}.
$$
(If only $\lambda_1=\lambda_2=\lambda_3=0$ works: independent. If some $\lambda_i\neq0$ works: we have found a dependence.)

Rewriting coordinate by coordinate gives a **system of 4 equations in 3 unknowns**:
$$
\begin{aligned}
1\lambda_1 + 1\lambda_2 + 3\lambda_3 &= 0\\
\lambda_1 + \lambda_2 + 3\lambda_3 &= 0\\
0\lambda_1 + 2\lambda_2 + 2\lambda_3 &= 0\\
0\lambda_1 + 0\lambda_2 + 0\lambda_3 &= 0
\end{aligned}
\qquad\text{i.e.}\qquad
\underbrace{\begin{pmatrix}1&1&3\\1&1&3\\0&2&2\\0&0&0\end{pmatrix}}_{\mathbf{v}_1\ \mathbf{v}_2\ \mathbf{v}_3 \text{ as columns}}
\begin{pmatrix}\lambda_1\\ \lambda_2\\ \lambda_3\end{pmatrix} = \begin{pmatrix}0\\0\\0\\0\end{pmatrix}.
$$

**In het algemeen.** All relations between $\mathbf{v}_1,\dots,\mathbf{v}_r$ are found by solving
$$
\boxed{A\boldsymbol{\lambda} = \mathbf{0}},\qquad A = \text{the matrix with } \mathbf{v}_1,\dots,\mathbf{v}_r \text{ as columns}.
$$
This is a **homogeneous system**; its solution set $S_{\mathrm{hom}}$ is also called the **nulruimte** of $A$: $\mathrm{Nul}(A) = \{\mathbf{x}\in\mathbb{R}^r \mid A\mathbf{x} = \mathbf{0}\}$. Solve it with Gauss–Jordan:
$$
(A\mid\mathbf{0}) \sim \dots \sim (A'\mid\mathbf{0}).
$$
The last column stays $\mathbf{0}$ throughout, so you may leave it out. And since row operations do not change $S_{\mathrm{hom}}$:

$$
\boxed{\text{relaties tussen de kolommen van } A \;\xleftrightarrow{\ 1\text{-}1\ }\; \text{relaties tussen de kolommen van } A'}
$$

In $A'$ (volledig rijgereduceerd) the relations can be **read off directly**.

### Worked example (from the board)

$S = \{\mathbf{v}_1,\mathbf{v}_2,\mathbf{v}_3,\mathbf{v}_4\}$ with
$\mathbf{v}_1 = (1,1,-2)^t$, $\mathbf{v}_2 = (2,1,-3)^t$, $\mathbf{v}_3 = (7,5,-12)^t$, $\mathbf{v}_4 = (11,5,-16)^t$. What are the relations?

$$
\begin{pmatrix}1&2&7&11\\1&1&5&5\\-2&-3&-12&-16\end{pmatrix}
\xrightarrow[r_3\to r_3+2r_1]{r_2\to r_2-r_1}
\begin{pmatrix}1&2&7&11\\0&-1&-2&-6\\0&1&2&6\end{pmatrix}
$$
$$
\xrightarrow[r_2\to -r_2]{r_3\to r_3+r_2}
\begin{pmatrix}1&2&7&11\\0&1&2&6\\0&0&0&0\end{pmatrix}
\xrightarrow{r_1\to r_1-2r_2}
\begin{pmatrix}\boxed{1}&0&3&-1\\0&\boxed{1}&2&6\\0&0&0&0\end{pmatrix}
$$

Read off from $A'$:
- column 3 $= 3\cdot$column 1 $+ 2\cdot$column 2: $(3,2,0)^t = 3(1,0,0)^t + 2(0,1,0)^t$,
  so **also** $\mathbf{v}_3 = 3\mathbf{v}_1 + 2\mathbf{v}_2$, i.e. $(7,5,-12)^t = 3(1,1,-2)^t + 2(2,1,-3)^t$. ✓
- column 4 $= -1\cdot$column 1 $+ 6\cdot$column 2: $(-1,6,0)^t = -(1,0,0)^t + 6(0,1,0)^t$,
  so **also** $\mathbf{v}_4 = -\mathbf{v}_1 + 6\mathbf{v}_2$, i.e. $(11,5,-16)^t = -(1,1,-2)^t + 6(2,1,-3)^t$. ✓

(Why "also"? Because a relation $A\boldsymbol{\lambda} = \mathbf{0}$ is a solution of the homogeneous system, and the solution set is preserved by Gauss–Jordan.)

**Conclusion.** $\mathbf{v}_1,\mathbf{v}_2$ are independent (the pivot columns: no relation with only $\lambda_1,\lambda_2$ non-zero) and they suffice to build every vector of $S$ as a linear combination, since $\mathbf{v}_3,\mathbf{v}_4$ depend on them. So $\{\mathbf{v}_1,\mathbf{v}_2\}$ is a basis of $\mathrm{Span}(S)$ and the rank is $2$.

> **Recipe (= Stelling 4.2.8).** Put the vectors as **columns** of $A$, row-reduce.
> The vectors in the **pivot columns** form a basis of the span; the number of
> pivots is the rank. Each non-pivot column of $A'$ tells you how the
> corresponding original vector is built from the pivot vectors.
> ⚠ Take the basis vectors from the **original** $A$, not from $A'$ — the rows
> have been mixed, so the columns of $A'$ are different vectors.

---

## 4. Rang, dimensie, basis (§4.2)

**Def. 7 (4.2.1).** Let $S\subseteq\mathbb{R}^n$, $S\neq\emptyset$. The **largest** number $r$ such that $S$ contains an $r$-tuple of **independent** vectors is the **rang** of $S$: $\mathrm{rang}(S) = r$.
If $S$ is a lineaire deelruimte we also call the rank the **dimensie**: $\dim(S)$. If $S = \{\mathbf{0}\}$ then $\dim(S) = 0$.

**Def. 8 (4.2.3).** Let $S\subseteq\mathbb{R}^n$. A finite subset $B\subseteq S$ is a **basis** of $S$ if
1. $B$ consists of **independent** vectors, and
2. every $\mathbf{v}\in S$ can be written as a linear combination of elements of $B$, i.e. $S\subseteq\mathrm{Span}(B)$.

In the motivating example: $B = \{(1,1,0,0)^t,(1,1,2,0)^t\}$ is a basis of $W$, $\dim W = 2$. For $\mathbb{R}^n$ itself, $\{\mathbf{e}_1,\dots,\mathbf{e}_n\}$ is a basis (the standaardbasis) and $\dim\mathbb{R}^n = n$.

---

## 5. The theorems of §4.1–4.2, as explained in the lecture

### Stelling 4.1.7 — coordinates w.r.t. a basis are unique

*If $\mathbf{b}_1,\dots,\mathbf{b}_r$ are independent and $\mathbf{v}$ depends on them, then $\mathbf{v}$ can be written as a linear combination of $\mathbf{b}_1,\dots,\mathbf{b}_r$ in exactly one way.*

**Bewijs.** Suppose $\mathbf{v} = \lambda_1\mathbf{b}_1 + \dots + \lambda_r\mathbf{b}_r$ and also $\mathbf{v} = \mu_1\mathbf{b}_1 + \dots + \mu_r\mathbf{b}_r$. Subtracting:
$$
(\lambda_1 - \mu_1)\mathbf{b}_1 + \dots + (\lambda_r - \mu_r)\mathbf{b}_r = \mathbf{0}.
$$
This is a relation between independent vectors, so it must be the trivial one: $\lambda_i - \mu_i = 0$, i.e. $\lambda_i = \mu_i$ for all $i$. $\square$

(With Def. 8 this gives Stelling 4.2.5: w.r.t. a basis every vector of $S$ has unique coordinates.)

### Stelling 4.2.2 (Hoofdstelling) — $n$ vectors span ⇒ rank ≤ $n$

*If $S\subseteq\mathrm{Span}(\mathbf{b}_1,\dots,\mathbf{b}_n)$ then $\mathrm{rang}(S)\le n$.*

The lecturer: "bewijs is best technisch", done at the end if time allows (see §6 below). The *idea* is the one thing to remember: **any $n+1$ vectors in the span of $n$ vectors are dependent**, and this comes down to a homogeneous system with more unknowns than equations (Stelling 3.5.2).

Consequence: every subset of $\mathbb{R}^n$ has rank $\le n$, because $\mathbb{R}^n = \mathrm{Span}(\mathbf{e}_1,\dots,\mathbf{e}_n)$.

### Stelling 4.2.6 — every basis has the same size, namely the rank

Let $\mathrm{rang}(S) = n$.

**(1) Every basis of $S$ has exactly $n$ elements.** In words: let $B = \{\mathbf{b}_1,\dots,\mathbf{b}_m\}$ be a basis.
- $\mathbf{b}_1,\dots,\mathbf{b}_m$ are independent, so $m\le n$ (by the *definition* of rank as the maximum).
- $S\subseteq\mathrm{Span}(\mathbf{b}_1,\dots,\mathbf{b}_m)$, so by the Hoofdstelling $n = \mathrm{rang}(S)\le m$.
- Hence $n = m$.

**(2) Every independent set of $n$ vectors in $S$ is a basis of $S$.**
- Independent: given.
- Does it span $S$? Suppose not. Then there is an $\mathbf{s}\in S$ independent of the $n$ vectors, giving $n+1$ independent vectors in $S$, so $\mathrm{rang}(S)\ge n+1$: contradiction.

### Stelling 4.2.8 — pivot columns form a basis

This is exactly the worked example in §3 ("hebben we dinsdag in ons voorbeeld gezien"): put the vectors as columns, reduce, the pivot columns (of the original matrix) form a basis, #pivots = rank.

### Stelling 4.2.9 — bases exist and can be extended

For non-empty $S\subseteq S'\subseteq\mathbb{R}^n$:
1. If $S\neq\{\mathbf{0}\}$ then $S$ has a basis.
2. Every basis of $S$ can be extended to a basis of $S'$.
3. $\mathrm{rang}(S)\le\mathrm{rang}(S')$.

**Bewijs in woorden (1).** Take $\mathbf{b}_1\in S$ ($\neq\mathbf{0}$). If $\mathbf{b}_1$ spans $S$: done. If not, there is $\mathbf{b}_2\in S$ independent of $\mathbf{b}_1$. If $\mathbf{b}_1,\mathbf{b}_2$ span $S$: done. If not, there is $\mathbf{b}_3\in S$ independent of $\mathbf{b}_1,\mathbf{b}_2$, etc. This process **stops**, because $\mathrm{rang}(S)\le n$ (Hoofdstelling): you can never have more than $n$ independent vectors. What you have when it stops is a basis.
(2) is the same process, started from the given basis of $S$ and picking new vectors from $S'$. (3) follows from (2).

### Stelling 4.2.10 — rank does not change under these moves

In words: **if you add to $S$, or remove from $S$, a vector that is dependent on the (other) vectors of $S$, the rank does not change.** (The dictaat phrases it as: replacing $\mathbf{v}$ by $\lambda\mathbf{v}$, $\lambda\neq0$, or by $\mathbf{v} + \lambda\mathbf{w}$, keeps the rank — these are exactly column versions of the row operations.)

---

## 6. Proof of the Hoofdstelling 4.2.2 (slide, "als er tijd is")

**Idea.** Take $n+1$ vectors $\mathbf{s}_1,\dots,\mathbf{s}_{n+1}\in S$ and show they are dependent by producing a non-trivial relation. Then no $n+1$ vectors of $S$ are independent, so $\mathrm{rang}(S)\le n$.

**How to find the relation?** Each $\mathbf{s}_i$ lies in $\mathrm{Span}(\mathbf{b}_1,\dots,\mathbf{b}_n)$, so write it out:
$$
\begin{aligned}
\mathbf{s}_1 &= a_{11}\mathbf{b}_1 + a_{12}\mathbf{b}_2 + \dots + a_{1n}\mathbf{b}_n &&\to\ \bar{\mathbf{a}}_1 = (a_{11},\dots,a_{1n})^t\\
\mathbf{s}_2 &= a_{21}\mathbf{b}_1 + \dots + a_{2n}\mathbf{b}_n &&\to\ \bar{\mathbf{a}}_2\\
&\ \ \vdots\\
\mathbf{s}_{n+1} &= a_{n+1,1}\mathbf{b}_1 + \dots + a_{n+1,n}\mathbf{b}_n &&\to\ \bar{\mathbf{a}}_{n+1}
\end{aligned}
$$
We obtain **$n+1$ coefficient vectors $\bar{\mathbf{a}}_1,\dots,\bar{\mathbf{a}}_{n+1}$ in $\mathbb{R}^n$.** Put them as columns of an $n\times(n+1)$ matrix:
$$
\begin{pmatrix} a_{11} & a_{21} & \cdots & a_{n+1,1}\\ \vdots & & & \vdots\\ a_{1n} & a_{2n} & \cdots & a_{n+1,n}\end{pmatrix}
= (\bar{\mathbf{a}}_1\ \cdots\ \bar{\mathbf{a}}_{n+1}).
$$
After Gauss–Jordan there are **at most $n$ pivots** (only $n$ rows), hence at most $n$ independent columns among $n+1$. So there is a non-trivial relation between the columns:
$$
\lambda_1\bar{\mathbf{a}}_1 + \dots + \lambda_{n+1}\bar{\mathbf{a}}_{n+1} = \mathbf{0},\quad\text{not all } \lambda_i = 0.
$$
Now compute, with the **same** $\lambda_i$:
$$
\begin{aligned}
\lambda_1\mathbf{s}_1 + \dots + \lambda_{n+1}\mathbf{s}_{n+1}
&= \lambda_1(a_{11}\mathbf{b}_1 + \dots + a_{1n}\mathbf{b}_n) + \dots\\ &\qquad + \lambda_{n+1}(a_{n+1,1}\mathbf{b}_1 + \dots + a_{n+1,n}\mathbf{b}_n)\\
&= (\lambda_1a_{11} + \lambda_2a_{21} + \dots + \lambda_{n+1}a_{n+1,1})\,\mathbf{b}_1 + \dots\\ &\qquad + (\lambda_1a_{1n} + \dots + \lambda_{n+1}a_{n+1,n})\,\mathbf{b}_n\\
&= 0\cdot\mathbf{b}_1 + \dots + 0\cdot\mathbf{b}_n = \mathbf{0},
\end{aligned}
$$
because each bracket is one coordinate of $\lambda_1\bar{\mathbf{a}}_1 + \dots + \lambda_{n+1}\bar{\mathbf{a}}_{n+1} = \mathbf{0}$. So $\mathbf{s}_1,\dots,\mathbf{s}_{n+1}$ are dependent. Hence $\mathrm{rang}(S)\le n$. $\square$

---

## Zelftest

1. Are $(1,2)^t$ and $(2,4)^t$ independent? *Answer:* no: $2(1,2)^t - (2,4)^t = \mathbf{0}$ is a non-trivial relation.
2. Are $(1,0,1)^t,(0,1,1)^t,(1,1,0)^t$ independent? *Answer:* columns into $A$, reduce: $\begin{pmatrix}1&0&1\\0&1&1\\1&1&0\end{pmatrix}\sim\begin{pmatrix}1&0&1\\0&1&1\\0&1&-1\end{pmatrix}\sim\begin{pmatrix}1&0&1\\0&1&1\\0&0&-2\end{pmatrix}$: 3 pivots, so only the trivial relation: independent, and they form a basis of $\mathbb{R}^3$ (Stelling 4.2.6(2)).
3. Can 4 vectors in $\mathbb{R}^3$ be independent? *Answer:* no — Hoofdstelling with $\mathbb{R}^3 = \mathrm{Span}(\mathbf{e}_1,\mathbf{e}_2,\mathbf{e}_3)$, rank $\le3$. Concretely: $A$ is $3\times4$, at most 3 pivots, so a free variable gives a non-trivial relation.
4. $A' = \begin{pmatrix}1&0&3&-1\\0&1&2&6\\0&0&0&0\end{pmatrix}$ came from $A$ with columns $\mathbf{v}_1,\dots,\mathbf{v}_4$. Write $\mathbf{v}_4$ in terms of the basis. *Answer:* $\mathbf{v}_4 = -\mathbf{v}_1 + 6\mathbf{v}_2$ (read column 4 of $A'$).
5. $W$ is a subspace with basis of 3 vectors. Someone gives you 3 other independent vectors in $W$. Are they a basis of $W$? *Answer:* yes, Stelling 4.2.6(2): $\dim W = 3$ and any 3 independent vectors in $W$ form a basis.
6. State the difference between "$\mathbf{w}$ is afhankelijk van $\mathbf{v}_1,\dots,\mathbf{v}_r$" and "$\mathbf{v}_1,\dots,\mathbf{v}_r$ is afhankelijk". *Answer:* the first is about one extra vector lying in the span (def. 3); the second is a property of the set: some member lies in the span of the others (def. 4), equivalently a non-trivial relation exists (Conclusie 2).
