# Week 2 — §3.1 & §3.2: Matrices en het oplossen van lineaire stelsels

> Lecture framing (slides 1–9): "Waar gaat lineaire algebra over?" Answer for
> now: **matrices, and using them to solve systems of linear equations** via
> the **Gauss–Jordan algorithm**.
>
> Convention for the rest of the course: $i,j,k,n,m\in\mathbb{N}$ with value $\ge 1$.

---

## 1. What is a matrix? (Def. 3.1.1)

An **$m\times n$ matrix** $A$ consists of $m\cdot n$ numbers from $\mathbb{R}$ (or $\mathbb{C}$)
arranged in **$m$ rijen** (rows) and **$n$ kolommen** (columns):

$$
A = \begin{pmatrix}
a_{11} & a_{12} & \cdots & a_{1n}\\
a_{21} & a_{22} & \cdots & a_{2n}\\
\vdots & & & \vdots\\
a_{m1} & a_{m2} & \cdots & a_{mn}
\end{pmatrix},
\qquad a_{ij}\in\mathbb{R}:\ i\text{-th row},\ j\text{-th column}.
$$

Also written $A_{ij}$. Mnemonic: **rows first, then columns** — "$m\times n$" = rows × columns.

The set of all $m\times n$ matrices is $M_{m,n}$ (dictaat: $M_{mn}$).

**Merk op:** $M_{m,1} = \mathbb{R}^m$ — a column vector *is* an $m\times 1$ matrix:
$\{(a_{11},\dots,a_{m1})^t \mid a_{i1}\in\mathbb{R}\}$.

## 2. Bewerkingen met matrices (§3.1)

### 2.1 Optelling (Def. 3.1.3)

Only defined for $A,B\in M_{m,n}$ with the **same format**. It works **componentsgewijs**:

$$
(A+B)_{ij} = A_{ij} + B_{ij}.
$$

VB:
$$
\begin{pmatrix} -1 & 0 & 3\\ 6 & 2 & 11\end{pmatrix}
+ \begin{pmatrix} 0 & 1 & 1\\ 3 & 0 & 1\end{pmatrix}
= \begin{pmatrix} -1 & 1 & 4\\ 9 & 2 & 12\end{pmatrix}.
$$

### 2.2 Scalaire vermenigvuldiging (Def. 3.1.3)

Also componentsgewijs. For $\lambda\in\mathbb{R}$, $A\in M_{m,n}$:

$$
(\lambda A)_{ij} = \lambda A_{ij}.
$$

VB:
$$
3\begin{pmatrix} 0 & -4\\ 1 & 1\\ 2 & 8\end{pmatrix}
= \begin{pmatrix} 0 & -12\\ 3 & 3\\ 6 & 24\end{pmatrix}.
$$

(The rules for $+$ and $\lambda\cdot$ are the same as for vectors: Stelling 3.1.4.)

### 2.3 Vermenigvuldiging (Def. 3.1.5) — the one that needs care

$AB$ is **only defined** when

$$
\#\text{kolommen van } A = \#\text{rijen van } B .
$$

If $A$ is $m\times n$ and $B$ is $n\times k$, then $AB$ is $m\times k$. The "inner" $n$'s
must match and disappear; the "outer" sizes survive:

```
   A      B        AB
 m × n  n × k  →  m × k
       ↑ must match
```

**Formula:** $(AB)_{ij}$ = ($i$-th row of $A$) $\cdot$ ($j$-th column of $B$), an inner product:

$$
(AB)_{ij} = a_{i1}b_{1j} + a_{i2}b_{2j} + \dots + a_{in}b_{nj} = \sum_{k=1}^{n} a_{ik}b_{kj}.
$$

VB (from the board):
$$
\begin{pmatrix} 1 & 0 & 3\\ -1 & 2 & 5\end{pmatrix}
\begin{pmatrix} 1 & 0 & 2 & 1\\ -1 & 1 & 0 & 1\\ 3 & 0 & 1 & 1\end{pmatrix}
= \begin{pmatrix} 10 & 0 & 5 & 4\\ 12 & 2 & 3 & 6\end{pmatrix}.
$$

E.g. entry $(1,1)$: row $(1,0,3)\cdot$ column $(1,-1,3) = 1 - 0 + 9 = 10$.
Entry $(2,4)$: $(-1,2,5)\cdot(1,1,1) = -1+2+5 = 6$. A $2\times3$ times a $3\times4$ gives a $2\times4$.

**Slide Q1.** $A = \begin{pmatrix}1&0\\0&4\\2&-1\end{pmatrix}$, $B = \begin{pmatrix}3&-1&2&0\\0&1&2&3\end{pmatrix}$.
$A$ is $3\times2$, $B$ is $2\times4$, so $AB$ is $3\times4$:

$$
AB = \begin{pmatrix} 3 & -1 & 2 & 0\\ 0 & 4 & 8 & 12\\ 6 & -3 & 2 & -3\end{pmatrix},
\qquad (AB)_{2,3} = (0,4)\cdot(2,2) = 8.
$$

($BA$ would be $2\times4$ times $3\times2$: not defined.)

### 2.4 Matrix multiplication is NOT commutative (slide Q2)

- If $A$ is $n\times m$ and $B$ is $m\times n$ with $n\neq m$: $AB$ is $n\times n$ but $BA$ is $m\times m$, so $AB\neq BA$ trivially (different sizes).
- Even for square matrices it usually fails. Lecture example ("blauw"):

$$
\begin{pmatrix}0&1\\0&1\end{pmatrix}\begin{pmatrix}1&0\\1&0\end{pmatrix}
= \begin{pmatrix}1&0\\1&0\end{pmatrix},
\qquad
\begin{pmatrix}1&0\\1&0\end{pmatrix}\begin{pmatrix}0&1\\0&1\end{pmatrix}
= \begin{pmatrix}0&1\\0&1\end{pmatrix},
$$

so $AB\neq BA$.

- Sometimes it *does* hold ("zwart"/"geel"): $\begin{pmatrix}1&0\\0&1\end{pmatrix}\begin{pmatrix}a&b\\c&d\end{pmatrix} = \begin{pmatrix}a&b\\c&d\end{pmatrix} = \begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{pmatrix}1&0\\0&1\end{pmatrix}$ — the identity matrix commutes with everything (Def. 3.1.6: such $A,B$ *commuteren*).

**Conclusie: matrixvermenigvuldiging is niet commutatief.** Never swap factors.
(What *does* hold: associativity $A(BC) = (AB)C$, distributivity, $IA = AI = A$ — Stelling 3.1.7.)

---

## 3. Gauss–Jordan eliminatie (§3.2)

**Goal.** Find *all* $x_1,x_2,x_3\in\mathbb{R}$ with

$$
\begin{aligned}
x_1 + x_2 - x_3 &= 1\\
2x_1 + 4x_2 - x_3 &= 4\\
-x_1 + 5x_2 + 6x_3 &= 9
\end{aligned}
$$

### 3.1 Which operations keep the solution set unchanged? (Stelling 3.2.5)

1. **Vergelijkingen verwisselen** (swap two equations).
2. **Een vergelijking links en rechts vermenigvuldigen met een getal $\neq 0$.**
3. **Een veelvoud van een vergelijking optellen bij een andere vergelijking.**

Two systems related by these moves are **equivalent** (notation $\sim$): they have
*exactly* the same oplossingsverzameling.

### 3.2 The algorithm: Gauss-eliminatie

- a) Put at the top an equation whose coefficient of $x_1$ is $\neq 0$.
- b) Use it to "wegvegen" (sweep away, make coefficient $0$) every $x_1$ in the equations below.
- c) Do the same for $x_2, x_3, \dots$ in rows $2, 3, \dots$.

Applied to the example:

$$
\begin{aligned}
x_1 + x_2 - x_3 &= 1\\
2x_2 + x_3 &= 2 \qquad (\text{r2} - 2\,\text{r1})\\
6x_2 + 5x_3 &= 10 \qquad (\text{r3} + \text{r1})
\end{aligned}
\quad\sim\quad
\begin{aligned}
x_1 + x_2 - x_3 &= 1\\
2x_2 + x_3 &= 2\\
2x_3 &= 4 \qquad (\text{r3} - 3\,\text{r2})
\end{aligned}
\qquad (*)
$$

Up to here it is called **Gauss-eliminatie**: you cannot sweep further *downwards*. Now two options:

**Methode 1 — terugsubstitutie** (from bottom to top):
$2x_3 = 4 \Rightarrow x_3 = 2$; $2x_2 + 2 = 2 \Rightarrow x_2 = 0$; $x_1 + 0 - 2 = 1 \Rightarrow x_1 = 3$.

**Methode 2 — Jordan-eliminatie**: Gauss in the *opposite* direction (start at the
bottom row and last variable, sweep *upwards*):

$$
(*)\ \sim\
\begin{aligned} x_1 + x_2 - x_3 &= 1\\ 2x_2 + x_3 &= 2\\ x_3 &= 2\end{aligned}
\ \sim\
\begin{aligned} x_1 + x_2 &= 3\\ 2x_2 &= 0\\ x_3 &= 2\end{aligned}
\ \sim\
\begin{aligned} x_1 &= 3\\ x_2 &= 0\\ x_3 &= 2\end{aligned}
$$

Either way: $(x_1,x_2,x_3)^t = (3,0,2)^t$.

### 3.3 In matrix language

The system is $A\mathbf{x} = \mathbf{b}$:

$$
\begin{pmatrix} 1 & 1 & -1\\ 2 & 4 & -1\\ -1 & 5 & 6\end{pmatrix}
\begin{pmatrix} x_1\\ x_2\\ x_3\end{pmatrix}
= \begin{pmatrix} 1\\ 4\\ 9\end{pmatrix}.
$$

Shorthand: the **uitgebreide (extended) coëfficiëntenmatrix** $(A\mid\mathbf{b})$:

$$
\left(\begin{array}{ccc|c} 1 & 1 & -1 & 1\\ 2 & 4 & -1 & 4\\ -1 & 5 & 6 & 9\end{array}\right)
\qquad
\begin{array}{l}\text{left block: de coëfficiëntenmatrix } A\\ \text{right column: de uitkomstvector } \mathbf{b}\end{array}
$$

Row operations $r_i \to \dots$ are the three allowed moves. Gauss–Jordan becomes:

$$
\left(\begin{array}{ccc|c} 1&1&-1&1\\ 2&4&-1&4\\ -1&5&6&9\end{array}\right)
\xrightarrow[r_3\to r_3+r_1]{r_2\to r_2-2r_1}
\left(\begin{array}{ccc|c} 1&1&-1&1\\ 0&2&1&2\\ 0&6&5&10\end{array}\right)
$$
$$
\xrightarrow{r_3\to r_3-3r_2}
\left(\begin{array}{ccc|c} 1&1&-1&1\\ 0&2&1&2\\ 0&0&2&4\end{array}\right)
\xrightarrow{r_3\to r_3/2}
\left(\begin{array}{ccc|c} 1&1&-1&1\\ 0&2&1&2\\ 0&0&1&2\end{array}\right)
$$

**Tot zover Gauss-eliminatie.** Then Jordan:

$$
\xrightarrow[r_2\to r_2-r_3]{r_1\to r_1+r_3}
\left(\begin{array}{ccc|c} 1&1&0&3\\ 0&2&0&0\\ 0&0&1&2\end{array}\right)
\xrightarrow{r_2\to r_2/2}
\left(\begin{array}{ccc|c} 1&1&0&3\\ 0&1&0&0\\ 0&0&1&2\end{array}\right)
\xrightarrow{r_1\to r_1-r_2}
\left(\begin{array}{ccc|c} 1&0&0&3\\ 0&1&0&0\\ 0&0&1&2\end{array}\right)
$$

Read off: $1x_1+0x_2+0x_3 = 3$, $0x_1+1x_2+0x_3 = 0$, $0x_1+0x_2+1x_3 = 2$, i.e. $\mathbf{x} = (3,0,2)^t$.

### 3.4 Terminologie (Def. 3.2.6, 3.2.8)

- After Gauss-eliminatie the matrix is in **rijgereduceerde vorm** (trapvorm). Toelichting: for every row (except the first) either
  - the number of **leidende nullen** (leading zeros) is strictly larger than in the row above, **or**
  - the row consists of zeros only.
- The first element $\neq 0$ in a row is a **pivot** (pivotelement).
- A variable $x_j$ is a **pivotvariabele** if column $j$ contains a pivot. In the example $x_1,x_2,x_3$ are all pivot variables.
- After Jordan as well (pivots $=1$, zeros above *and* below each pivot) the matrix is **volledig rijgereduceerd**.

> Gauss-eliminatie alone is already enough to *analyse* a system (how many
> solutions?). Jordan just makes reading off the solution trivial.

---

## 4. The role of pivots: three examples

### VB1 — all variables are pivot variables → unique solution

After Gauss–Jordan: $\left(\begin{array}{ccc|c} 1&0&0&3\\ 0&1&0&0\\ 0&0&1&2\end{array}\right)$.
Pivots in columns $x_1,x_2,x_3$ → every value is fixed: $(3,0,2)^t$.

### VB2 — a row of zeros: strijdig or a free variable

$$
\begin{aligned} x_1 - 2x_2 &= 1\\ -2x_1 + 4x_2 &= a\end{aligned}\quad(a\in\mathbb{R}),
\qquad
\left(\begin{array}{cc|c} 1&-2&1\\ -2&4&a\end{array}\right)
\xrightarrow{r_2\to r_2+2r_1}
\left(\begin{array}{cc|c} 1&-2&1\\ 0&0&a+2\end{array}\right)
$$

Pivot only in column 1: $x_1$ is a pivot variable, $x_2$ is **not**. The last row says
$0x_1 + 0x_2 = a+2$. **Gevalsonderscheiding:**

- **$a\neq -2$:** $0 = a+2 \neq 0$ is impossible → the system is **strijdig** (Def. 3.2.3: no solution).
  *General rule:* a row of all zeros on the left with a non-zero number on the right ⇒ strijdig.
- **$a = -2$:** the row reads $0 = 0$ and gives no information. The non-pivot variable $x_2$ can be chosen freely: put $x_2 = t$, $t\in\mathbb{R}$. Then $x_1 - 2t = 1$, so $x_1 = 1+2t$. Solution set:

$$
\begin{pmatrix} x_1\\ x_2\end{pmatrix} = \begin{pmatrix} 1+2t\\ t\end{pmatrix}
= \begin{pmatrix} 1\\ 0\end{pmatrix} + t\begin{pmatrix} 2\\ 1\end{pmatrix},\quad t\in\mathbb{R}
\quad\Rightarrow\ \text{a line in the plane.}
$$

**Opmerkingen (from the board):**

1. A zero row: strijdig if the right-hand side $\neq 0$; "no information" if it is $0$.
2. **Niet-pivotvariabelen zijn vrij te kiezen. Pivotvariabelen liggen vast** once the non-pivot variables have been chosen.

### VB3 — several free variables (5 unknowns, 3 equations)

$$
\begin{aligned}
x_1 + 2x_2 + x_4 + x_5 &= 1\\
2x_1 + 4x_2 + x_3 + 4x_4 + 3x_5 &= 1\\
-x_1 - 2x_2 + x_3 + x_4 &= -2
\end{aligned}
$$

$$
\left(\begin{array}{ccccc|c} 1&2&0&1&1&1\\ 2&4&1&4&3&1\\ -1&-2&1&1&0&-2\end{array}\right)
\xrightarrow[r_3\to r_3+r_1]{r_2\to r_2-2r_1}
\left(\begin{array}{ccccc|c} 1&2&0&1&1&1\\ 0&0&1&2&1&-1\\ 0&0&1&2&1&-1\end{array}\right)
$$
$$
\xrightarrow{r_3\to r_3-r_2}
\left(\begin{array}{ccccc|c} \boxed{1}&2&0&1&1&1\\ 0&0&\boxed{1}&2&1&-1\\ 0&0&0&0&0&0\end{array}\right)
$$

This is already volledig rijgereduceerd. Pivots in columns 1 and 3, so:

- **Niet strijdig** (zero row has $0$ on the right).
- $x_1, x_3$ are pivot variables → fixed once the others are chosen.
- $x_2, x_4, x_5$ are not pivot variables → **vrij te kiezen**: $x_2 = s$, $x_4 = t$, $x_5 = u$.

Back-substitute: $x_3 + 2t + u = -1 \Rightarrow x_3 = -1 - 2t - u$;
$x_1 + 2s + t + u = 1 \Rightarrow x_1 = 1 - 2s - t - u$. Oplossingsverzameling:

$$
\left\{
\begin{pmatrix} 1-2s-t-u\\ s\\ -1-2t-u\\ t\\ u\end{pmatrix}
\;\middle|\; s,t,u\in\mathbb{R}\right\}
=
\left\{
\begin{pmatrix} 1\\0\\-1\\0\\0\end{pmatrix}
+ s\begin{pmatrix} -2\\1\\0\\0\\0\end{pmatrix}
+ t\begin{pmatrix} -1\\0\\-2\\1\\0\end{pmatrix}
+ u\begin{pmatrix} -1\\0\\-1\\0\\1\end{pmatrix}
\;\middle|\; s,t,u\in\mathbb{R}\right\}
$$

→ a **3-dimensional "vlak" of solutions in $\mathbb{R}^5$**: one steunvector plus three
direction vectors, exactly the week-1 pattern $\mathbf{p} + \lambda\mathbf{a} + \mu\mathbf{b} + \dots$.

> Pattern to memorise: **#free parameters = #variables − #pivots.** Each free
> variable contributes one direction vector to the solution set.

---

## Decision table after Gauss elimination

| What you see in $(A'\mid\mathbf{b}')$ | Conclusion |
|---|---|
| A row $(0\ \cdots\ 0 \mid c)$ with $c\neq 0$ | **Strijdig**: no solution |
| No such row, every variable is a pivot variable | **Exactly one** solution |
| No such row, some variable is not a pivot variable | **Infinitely many** solutions; free variables = parameters |

---

## Zelftest

1. $A\in M_{3,2}$, $B\in M_{2,5}$. Is $AB$ defined? $BA$? Sizes?
   *Answer:* $AB$ yes, $3\times5$. $BA$: $2\times5$ times $3\times2$, $5\neq3$, not defined.
2. Compute $(AB)_{3,1}$ for the Q1 matrices. *Answer:* row 3 of $A$ is $(2,-1)$, column 1 of $B$ is $(3,0)$: $6$.
3. Give the three row operations and say why each keeps the solution set.
   *Answer:* swap rows (same equations, other order); multiply a row by $c\neq0$ (divide by $c$ to get back); add a multiple of one row to another (subtract it again to get back). Each is reversible, so no solutions are gained or lost.
4. Reduce $\left(\begin{array}{cc|c} 2&4&2\\ 1&2&3\end{array}\right)$ and classify.
   *Answer:* $r_1\to r_1/2$ gives $(1\,2\mid1)$; $r_2\to r_2-r_1$ gives $(0\,0\mid2)$. Row $0=2$ ⇒ strijdig.
5. In VB3, why are there exactly three direction vectors?
   *Answer:* 5 variables, 2 pivots, so $5-2=3$ free variables $s,t,u$.
