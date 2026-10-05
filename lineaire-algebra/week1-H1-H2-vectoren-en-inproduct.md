# Week 1 — Hoofdstuk 1 & 2: Vectoren, lijnen, vlakken en het inproduct

> Lecture framing: "Voorbereidingen voor lineaire algebra. H1 + H2, meeste
> herhaling VWO." So this week is mostly a refresher, but the *notation* and
> the *way of thinking in sets* (`{ ... | λ ∈ ℝ }`) are used in every later week.

---

## 1. The intuitive vector (Def. 1.1.1)

A **vector** is a *translation in space* (een verschuiving). It has two pieces of data:

- a **richting** (direction),
- a **grootte / lengte** (magnitude), written $|\mathbf{v}|$.

If the arrow goes from point $A$ to point $B$ we write $\mathbf{v} = \overrightarrow{AB}$.
Two arrows that are parallel, equally long and point the same way are the *same* vector.

## 2. Bewerkingen (operations) — Def. 1.1.2–1.1.4, rules in Stelling 1.1.5

| # | Operation | Picture / meaning |
|---|-----------|-------------------|
| 1 | **Optelling** $\mathbf{a}+\mathbf{b}$ | Put the tail of $\mathbf{b}$ at the head of $\mathbf{a}$; the sum is the arrow from the start of $\mathbf{a}$ to the end of $\mathbf{b}$ (parallelogram rule). |
| 2 | **Scalaire vermenigvuldiging** $\lambda\mathbf{a}$, $\lambda\in\mathbb{R}$ | Same direction, length scaled by $\lambda$ (e.g. $2\mathbf{a}$, $2.7\mathbf{a}$); $\lambda<0$ flips the direction ($-\mathbf{a}$). |
| 3 | **Verschilvector** $\mathbf{b}-\mathbf{a}$ | The vector such that $\mathbf{a} + (\mathbf{b}-\mathbf{a}) = \mathbf{b}$: the arrow from the head of $\mathbf{a}$ to the head of $\mathbf{b}$. |
| 4 | **Nulvector** $\mathbf{0}$ | Has length $0$. |

"Scalair" just means *a number from $\mathbb{R}$*. The rekenregels
(commutativity, associativity, distributivity) are listed in Stelling 1.1.5 of the
dictaat (p. 7); you may use them without proof.

## 3. Doing geometry: oorsprong + assenstelsel (§1.2, §1.3)

To actually *compute* with vectors we make two choices:

1. **Oorsprong $O$**: every vector is drawn starting at $O$. Then a point $P$
   is identified with the vector $\overrightarrow{OP}$, and $O$ itself with $\mathbf{0}$.
2. **Assenstelsel**: choose an *ordered* set of vectors $\mathbf{e}_1,\mathbf{e}_2,\mathbf{e}_3$
   (for 3-dimensional space) that are
   - of length $1$, and
   - **onderling loodrecht** (mutually perpendicular).

With respect to (t.o.v.) $\{\mathbf{e}_1,\mathbf{e}_2,\mathbf{e}_3\}$ every vector can be written as

$$
\mathbf{x} = x_1\mathbf{e}_1 + x_2\mathbf{e}_2 + x_3\mathbf{e}_3
\;=\; \begin{pmatrix} x_1\\ x_2\\ x_3\end{pmatrix},\qquad x_i\in\mathbb{R}.
$$

The numbers $x_1,x_2,x_3$ are the **coördinaten** of $\mathbf{x}$ t.o.v. $\{\mathbf{e}_1,\mathbf{e}_2,\mathbf{e}_3\}$
(Def. 1.3.1). The column of coordinates is an element of $\mathbb{R}^3$ (Def. 1.3.2).
In a line of text the dictaat writes $(x_1,x_2,x_3)^t$ for the column.

## 4. Points, lines and planes as *sets* of vectors (§1.2, §1.4)

The key habit of this course: a geometric object is a **verzameling** (set) of
vectors, written as `{ formula | parameter ranges over ℝ }`. Read `|` as
"waarvoor geldt" (for which holds).

### Lines

| Case | Parametrisation | Names |
|--------------------|------------------------------|------------------------|
| VB1: line $l$ through $\mathbf{0}$ | $l = \{\lambda\mathbf{a} \mid \lambda\in\mathbb{R}\}$ | $\mathbf{a}$ is the **richtingsvector** |
| VB2: line $m$ *not* through $\mathbf{0}$ | $m = \{\mathbf{p} + \lambda\mathbf{a} \mid \lambda\in\mathbb{R}\}$ | $\mathbf{p}$ is the **steunvector**, $\mathbf{a}\neq\mathbf{0}$ the richtingsvector |

This is Def. 1.2.1. Line through two points $P$ and $Q$ (with vectors $\mathbf{p},\mathbf{q}$):

$$
\{\mathbf{p} + \lambda(\mathbf{q}-\mathbf{p}) \mid \lambda\in\mathbb{R}\}
$$

(steunvector $\mathbf{p}$, direction = the difference vector $\mathbf{q}-\mathbf{p}$).

### Planes

| Case | Parametrisation |
|--------------------|----------------------------------------|
| VB3: plane $V$ through $\mathbf{0}$ | $V = \{\lambda\mathbf{a} + \mu\mathbf{b} \mid \lambda,\mu\in\mathbb{R}\}$ |
| VB4: plane $W$ not through $\mathbf{0}$ | $W = \{\mathbf{p} + \lambda\mathbf{a} + \mu\mathbf{b} \mid \lambda,\mu\in\mathbb{R}\}$ |

Requirement: the two richtingsvectoren $\mathbf{a},\mathbf{b}$ must **not lie on one
line** (they are *onafhankelijk*, Def. 1.2.4: neither is a scalar multiple of
the other). This is Def. 1.2.5. Sketch from the lecture: with $\lambda\mathbf{a}$ and
$\mu\mathbf{b}$ you can reach *every* point of the plane, which is what
"parametriseren" means.

Plane through three points $P,Q,R$ (not on one line):

$$
V = \{\mathbf{p} + \lambda(\mathbf{q}-\mathbf{p}) + \mu(\mathbf{r}-\mathbf{p}) \mid \lambda,\mu\in\mathbb{R}\}.
$$

> Steunvector and richtingsvectoren are **not unique**: any point of the
> object can serve as steunvector, any non-zero multiple of a direction works.

---

## 5. Length of a vector in $\mathbb{R}$, $\mathbb{R}^2$, $\mathbb{R}^3$, $\mathbb{R}^n$

| Space | Vector | Length |
|-------|--------|--------|
| 1-dim, $\mathbb{R}$ | $\mathbf{x} = x_1\mathbf{e}_1 = (x_1)$ | $\lvert\mathbf{x}\rvert = \lvert x_1\rvert = \sqrt{x_1^2}$ (absolute value) |
| 2-dim, $\mathbb{R}^2 = \mathbb{R}\times\mathbb{R}$ | $\mathbf{x} = x_1\mathbf{e}_1 + x_2\mathbf{e}_2$ | $\lvert\mathbf{x}\rvert = \sqrt{x_1^2 + x_2^2}$ (Pythagoras) |
| 3-dim, $\mathbb{R}^3$ | $\mathbf{x} = x_1\mathbf{e}_1 + x_2\mathbf{e}_2 + x_3\mathbf{e}_3$ | $\lvert\mathbf{x}\rvert = \sqrt{x_1^2 + x_2^2 + x_3^2}$ (Pythagoras applied **twice**: first in the floor, then up) |
| $n$-dim, $\mathbb{R}^n$ ($n\in\mathbb{N}$, $n>0$) | $(x_1,\dots,x_n)^t$ t.o.v. $\{\mathbf{e}_1,\dots,\mathbf{e}_n\}$ | $\sqrt{x_1^2+\dots+x_n^2}$ |

Why bother with $n>3$? Two lecture examples:

- A particle: $(x_1,x_2,x_3,v_1,v_2,v_3,t,T)^t$ = position, velocity, time, temperature → a vector in $\mathbb{R}^8$.
- Ten factories, $x_i$ = production of factory $i$ in a year → $(x_1,\dots,x_{10})^t\in\mathbb{R}^{10}$.

Def. 2.5.1: $\mathbb{R}^n$ is the set of ordered $n$-tuples of reals; addition and
scalar multiplication go coordinate-wise.

---

## 6. The inner product (inproduct / dotproduct) — plan in three steps

The lecturer's plan:

1. Define the inner product on $\mathbb{R}^2$ and $\mathbb{R}^3$ **geometrically**.
2. Express it **in coordinates**.
3. Use the coordinate formula to **define** it on $\mathbb{R}^n$ — so we can do
   geometry in $\mathbb{R}^n$. (For this we need Cauchy–Schwarz!)

### Step 1 — geometric definition (Def. 2.1.1)

For $\mathbf{v},\mathbf{w}\in\mathbb{R}^3$ (or $\mathbb{R}^2$), with $\varphi\in[0,\pi]$ the angle between them:

$$
\mathbf{v}\cdot\mathbf{w} := |\mathbf{v}|\,|\mathbf{w}|\cos\varphi,
\qquad\text{and } \mathbf{v}\cdot\mathbf{w} := 0 \text{ if } \mathbf{v}=\mathbf{0} \text{ or } \mathbf{w}=\mathbf{0}.
$$

**Meetkundig:** drop the perpendicular from the head of $\mathbf{w}$ onto the line of
$\mathbf{v}$; call the foot vector $\mathbf{x}$ (the *loodrechte projectie* of $\mathbf{w}$ on $\mathbf{v}$).
Then $\cos\varphi = |\mathbf{x}|/|\mathbf{w}|$, so $|\mathbf{x}| = |\mathbf{w}|\cos\varphi$ and

$$
\mathbf{v}\cdot\mathbf{w} = |\mathbf{v}|\,|\mathbf{x}|.
$$

So the inner product is "length of $\mathbf{v}$ times the length of the shadow of $\mathbf{w}$ on $\mathbf{v}$".

**Three immediate consequences ("we zien"):**

1. $\mathbf{v}\cdot\mathbf{w} = 0 \iff \mathbf{v}\perp\mathbf{w}$ or $\mathbf{v}=\mathbf{0}$ or $\mathbf{w}=\mathbf{0}$.
2. $\mathbf{v}\cdot\mathbf{v} = |\mathbf{v}|^2 \ge 0$, and $\mathbf{v}\cdot\mathbf{v} = 0 \iff \mathbf{v}=\mathbf{0}$.
3. If $\mathbf{v},\mathbf{w}\neq\mathbf{0}$ then $\displaystyle \varphi = \cos^{-1}\!\left(\frac{\mathbf{v}\cdot\mathbf{w}}{|\mathbf{v}||\mathbf{w}|}\right)$.

Point 3 is only useful if we can compute $\mathbf{v}\cdot\mathbf{w}$ *without* already knowing $\varphi$. That's step 2.

### Step 2 — in coordinates (Stelling 2.2.2)

If $\mathbf{x} = (x_1,x_2,x_3)^t$ and $\mathbf{y} = (y_1,y_2,y_3)^t$ then

$$
\boxed{\;\mathbf{x}\cdot\mathbf{y} = x_1y_1 + x_2y_2 + x_3y_3\;}
$$

**Bewijsschets (as in the lecture).** Draw the triangle with sides $\mathbf{x}$,
$\mathbf{y}$ and $\mathbf{y}-\mathbf{x}$. The **cosinusregel** (Stelling 2.2.1) gives

$$
|\mathbf{y}-\mathbf{x}|^2 = |\mathbf{x}|^2 + |\mathbf{y}|^2 - 2\,|\mathbf{x}||\mathbf{y}|\cos\varphi
= |\mathbf{x}|^2 + |\mathbf{y}|^2 - 2\,\mathbf{x}\cdot\mathbf{y}.
$$

Hence

$$
\mathbf{x}\cdot\mathbf{y} = \tfrac12\big(|\mathbf{x}|^2 + |\mathbf{y}|^2 - |\mathbf{y}-\mathbf{x}|^2\big),
$$

and the right-hand side you simply write out in coordinates using the length
formula; all the squares cancel and $x_1y_1+x_2y_2+x_3y_3$ remains (full
computation: dictaat p. 20).

### Step 3 — definition on $\mathbb{R}^n$ (Def. 2.5.2)

For $\mathbf{x} = (x_1,\dots,x_n)^t$, $\mathbf{y} = (y_1,\dots,y_n)^t$ we **define**

$$
\mathbf{x}\cdot\mathbf{y} = x_1y_1 + x_2y_2 + \dots + x_ny_n,
\qquad |\mathbf{x}| = \sqrt{\mathbf{x}\cdot\mathbf{x}}.
$$

The algebraic properties (symmetry, scalars pull out, distributivity,
$\mathbf{x}\cdot\mathbf{x}\ge 0$) are Stelling 2.2.4 (lecture slides 8–11).

**Opmerking over Cauchy–Schwarz** (Stelling 2.5.3):

$$
|\mathbf{x}\cdot\mathbf{y}| \le |\mathbf{x}|\,|\mathbf{y}|.
$$

- For $n = 2,3$ this is immediate: $|\mathbf{x}\cdot\mathbf{y}| = |\mathbf{x}||\mathbf{y}||\cos\varphi| \le |\mathbf{x}||\mathbf{y}|$.
- For $n>3$ there is no picture; the proof is in the dictaat (p. 25) and is "niet intuïtief".
- **Gevolg:** because Cauchy–Schwarz guarantees $\frac{\mathbf{x}\cdot\mathbf{y}}{|\mathbf{x}||\mathbf{y}|}\in[-1,1]$,
  we can *define* the angle between $\mathbf{x},\mathbf{y}\in\mathbb{R}^n$ (both $\neq\mathbf{0}$) as
  $\varphi = \cos^{-1}\!\big(\frac{\mathbf{x}\cdot\mathbf{y}}{|\mathbf{x}||\mathbf{y}|}\big)$.
  That is what "geometry in $\mathbb{R}^n$" means.

---

## 7. Equation of a plane in $\mathbb{R}^3$ via the inner product (§2.3)

Let $V$ be a plane with steunvector $\mathbf{p}$.

**Def. (2.3.1):** $\mathbf{n}\neq\mathbf{0}$ is a **normaalvector** of $V$ if $\mathbf{n}$ is perpendicular to $V$.

What does "perpendicular to $V$" mean? For every $\mathbf{x}$ on $V$ the vector
$\mathbf{x}-\mathbf{p}$ lies *in* $V$ (picture: all the red arrows from $\mathbf{p}$ within the plane), so

$$
\mathbf{n}\cdot(\mathbf{x}-\mathbf{p}) = 0 \quad\text{for all } \mathbf{x}\in V.
$$

Expand: $\mathbf{n}\cdot\mathbf{x} - \mathbf{n}\cdot\mathbf{p} = 0$, i.e.

$$
\boxed{\;\mathbf{n}\cdot\mathbf{x} = \mathbf{n}\cdot\mathbf{p}\;}\qquad
n_1x_1 + n_2x_2 + n_3x_3 = \text{(a number)}.
$$

This is the **vergelijking van het vlak** (Def. 1.4.5: $ax_1+bx_2+cx_3 = d$).

**VB (lecture):** $\mathbf{p} = (0,1,1)^t$, $\mathbf{n} = (1,1,1)^t$. Then
$\mathbf{x}\in V \iff (1,1,1)^t\cdot\mathbf{x} = (1,1,1)^t\cdot(0,1,1)^t = 2$, so

$$
x_1 + x_2 + x_3 = 2.
$$

### Two descriptions of the same plane

| Parametrisatie | Vergelijking |
|----------------|--------------|
| $V = \{\mathbf{p} + \lambda\mathbf{a} + \mu\mathbf{b} \mid \lambda,\mu\in\mathbb{R}\}$ | $(\mathbf{x}-\mathbf{p})\cdot\mathbf{n} = 0$ |

### Omgekeerd: the coefficients *are* a normal vector

**Claim.** If $ax_1 + bx_2 + cx_3 = d$ is an equation of a plane $V$, then
$\mathbf{n} = (a,b,c)^t$ is a normaalvector of $V$.

**Bewijs (from the notes).** Let $\mathbf{p} = (p_1,p_2,p_3)^t$ be a steunvector (so
$ap_1+bp_2+cp_3 = d$). We want: for every $\mathbf{x}\in V$, $(\mathbf{p}-\mathbf{x})\perp\mathbf{n}$. Compute

$$
\begin{pmatrix} a\\ b\\ c\end{pmatrix}\cdot
\begin{pmatrix} p_1-x_1\\ p_2-x_2\\ p_3-x_3\end{pmatrix}
= (ap_1+bp_2+cp_3) - (ax_1+bx_2+cx_3) = d - d = 0,
$$

so $(\mathbf{p}-\mathbf{x})\perp\mathbf{n}$. $\square$

### From equation to parametrisation (slide vraag 5)

Plane $V$: $3x_1 + 4x_2 + x_3 = 2$. Solve for one variable: $x_3 = 2 - 3x_1 - 4x_2$.
Let $x_1 = \lambda$, $x_2 = \mu$ be free:

$$
\begin{pmatrix} x_1\\ x_2\\ x_3\end{pmatrix}
= \begin{pmatrix} \lambda\\ \mu\\ 2-3\lambda-4\mu\end{pmatrix}
= \begin{pmatrix} 0\\ 0\\ 2\end{pmatrix}
+ \lambda\begin{pmatrix} 1\\ 0\\ -3\end{pmatrix}
+ \mu\begin{pmatrix} 0\\ 1\\ -4\end{pmatrix},
$$

a parametrisation of $V$. (Check: $(1,0,-3)\cdot(3,4,1) = 0$ and $(0,1,-4)\cdot(3,4,1)=0$, so both directions are indeed $\perp\mathbf{n}$.)

From parametrisation to equation you go the other way: eliminate $\lambda,\mu$,
*or* find $\mathbf{n}$ perpendicular to both direction vectors and use
$\mathbf{n}\cdot\mathbf{x} = \mathbf{n}\cdot\mathbf{p}$ (Voorbeeld 2.3.2 in the dictaat).

---

## Zelftest (the lecture's slide questions)

1. **Vraag 1/2.** Give a parametrisation of the line through $P=(1,2,-1)^t$ and $Q=(2,0,1)^t$.
   *Answer:* $\{\mathbf{p} + \lambda(\mathbf{q}-\mathbf{p})\} = \{(1,2,-1)^t + \lambda(1,-2,2)^t \mid \lambda\in\mathbb{R}\}$ (any steunvector on the line and any multiple of the direction is fine).
2. **Vraag 3.** Parametrise the plane through $P,Q,R$.
   *Answer:* $\{\mathbf{p} + \lambda(\mathbf{q}-\mathbf{p}) + \mu(\mathbf{r}-\mathbf{p}) \mid \lambda,\mu\in\mathbb{R}\}$, valid when $P,Q,R$ are not collinear.
3. **Vraag 4.** Angle between $(1,1,1)^t$ and $(1,0,0)^t$.
   *Answer:* $\mathbf{x}\cdot\mathbf{y} = 1$, $|\mathbf{x}| = \sqrt3$, $|\mathbf{y}| = 1$, so $\varphi = \cos^{-1}(1/\sqrt3)$. (This was the "blauw" answer on the slide.)
4. **Vraag 5.** Parametrise $3x_1+4x_2+x_3 = 2$. *Answer:* see §7 above.
5. Why does $\mathbf{v}\cdot\mathbf{v} = |\mathbf{v}|^2$? *Answer:* $\varphi = 0$, $\cos 0 = 1$.
6. A plane has equation $x_1 - 2x_2 + 5x_3 = 7$. Write down a normal vector and one point on it.
   *Answer:* $\mathbf{n} = (1,-2,5)^t$; e.g. $\mathbf{p} = (7,0,0)^t$.
