# Week 3 — §3.3, §3.4, §3.5: Vierkante stelsels, inverse matrices, lineaire deelruimten en de meetkunde van de oplossingsverzameling

> Lecture framing: "Vandaag zijn alle matrices vierkant" for the first part:
> $A\mathbf{x} = \mathbf{b}$ with $A\in M_{n,n}$, $\mathbf{x},\mathbf{b}\in\mathbb{R}^n$.
> The second part (§3.4, §3.5) is again for general $A\in M_{m,n}$.

---

## 1. Conclusies van vorige week (square case)

Picture after **Gauss-eliminatie** of an $n\times n$ system, two possible outcomes:

**Rood — $n$ pivots:**
$$
\left(\begin{array}{cccc|c}
1 & * & \cdots & * & b_1'\\
0 & 1 & \cdots & * & b_2'\\
\vdots & & \ddots & & \vdots\\
0 & 0 & \cdots & 1 & b_n'
\end{array}\right)
$$
Work from bottom to top: $x_n = b_n'$, $x_{n-1} = *\,x_n + b_{n-1}'$, …, $x_1 = *\,x_2 + \dots + *\,x_n + b_1'$.
**All values are uniquely fixed.**

**Blauw — fewer than $n$ pivots**, e.g. last row all zeros:
$$
\left(\begin{array}{cccc|c}
1 & * & \cdots & * & b_1'\\
0 & 1 & \cdots & * & b_2'\\
\vdots & & \ddots & & \vdots\\
0 & 0 & \cdots & 0 & b_n'
\end{array}\right)
\qquad 0\cdot x_n = b_n':\ \begin{cases}\text{strijdig} & \text{if } b_n'\neq 0,\\ x_n \text{ vrij te kiezen} & \text{if } b_n' = 0.\end{cases}
$$
Bottom to top: if $x_i$ is a pivot variable then $x_i = *\,x_{i+1} + \dots + *\,x_n + b_i'$ is
fixed once $x_{i+1},\dots,x_n$ are chosen.

**Groen:** #vrije variabelen $= n - \#\text{pivots}$.

### Conclusie 1

For $A\in M_{n,n}$ the following are **equivalent**:

1. $A$ has $n$ pivot variables (after row reduction).
2. For **every** $\mathbf{b}\in\mathbb{R}^n$ the system $A\mathbf{x} = \mathbf{b}$ has a **unique** solution.
3. There **exists** a $\mathbf{b}\in\mathbb{R}^n$ such that $A\mathbf{x} = \mathbf{b}$ has a unique solution.

(1 ⇒ 2 is the red picture; 2 ⇒ 3 is trivial; 3 ⇒ 1 because with fewer than $n$
pivots you never get uniqueness: either strijdig or a free variable.)
**Stelling 3.3.1** in the dictaat summarises this: $r = n$ pivots ⇒ exactly one
solution; $r<n$ ⇒ none or infinitely many; and uniqueness for some $\mathbf{b}$ forces $r=n$.

---

## 2. Inverteerbare matrices (§3.3)

### 2.1 Motivation: the case $n=1$

$ax = c$ with $a,c\in\mathbb{R}$.

- **Geval 1:** $a\neq0$. Then $x = \frac1a\cdot c = \frac ca$ is the **unique** solution. (Picture: a non-horizontal line hits every horizontal level $c$ exactly once.)
- **Geval 2:** $a = 0$, so $0\cdot x = c$:
  - 2a: $c = 0$ → $0x = 0$: **infinitely many** solutions.
  - 2b: $c\neq0$ → **no** solution (strijdig).

**Vandaag:** how do we generalise "$a\neq 0$, so $1/a$ exists" to $n>1$?

### 2.2 Identity matrix and the definition

**Notatie.** For $n\ge1$, $I_n$ is the $n\times n$ **identiteitsmatrix**:
$$
(I_n)_{ij} = \begin{cases}1 & i=j\\ 0 & i\neq j\end{cases},\qquad
I_n = \begin{pmatrix}1&0&\cdots&0\\0&1&&0\\ \vdots&&\ddots&\vdots\\0&0&\cdots&1\end{pmatrix}.
$$
For every $A\in M_{n,n}$: $IA = AI = A$.

**Def. 3.3.3.** Let $A\in M_{n,n}$.

1. A matrix $B\in M_{n,n}$ is called **the inverse of $A$** if $AB = I_n$. Notation $B = A^{-1}$ (**not** $1/A$).
2. $A$ is **inverteerbaar** if $A$ has an inverse.

**Opmerkingen** (both are part of Stelling 3.3.4, proved below):
1. If $AB = I_n$ then automatically $BA = I_n$ too.
2. If $A$ has an inverse, it is **unique**.

### 2.3 Two small examples (slide)

**VB1.** Does $\begin{pmatrix}1&2\\2&4\end{pmatrix}$ have an inverse? Try
$$
\begin{pmatrix}1&2\\2&4\end{pmatrix}\begin{pmatrix}a&b\\c&d\end{pmatrix}
= \begin{pmatrix}a+2c & b+2d\\ 2a+4c & 2b+4d\end{pmatrix}
\overset{?}{=}\begin{pmatrix}1&0\\0&1\end{pmatrix}.
$$
We would need $a+2c = 1$ **and** $2a+4c = 0$, i.e. $2(a+2c) = 0$: contradiction. **No inverse.**

**VB2.** $\begin{pmatrix}1&2\\2&5\end{pmatrix}\begin{pmatrix}5&-2\\-2&1\end{pmatrix} = \begin{pmatrix}1&0\\0&1\end{pmatrix}$, so this one **is** invertible.

### 2.4 Stelling 3.3.4 (combined with Conclusie 1)

Let $A\in M_{n,n}$. The following are equivalent:

1. $A$ is inverteerbaar.
2. $A$ has $n$ pivots after row reduction.
3. For every $\mathbf{c}\in\mathbb{R}^n$, $A\mathbf{x} = \mathbf{c}$ has a unique solution.
4. There is a $\mathbf{c}\in\mathbb{R}^n$ such that $A\mathbf{x} = \mathbf{c}$ has a unique solution.

(2 ⟺ 3 ⟺ 4 is Conclusie 1. So the new content is 1 ⟺ 3.)

#### Proof of 3 ⇒ 1 ("how do we build $B$ with $AB = I$?")

**Algemene opmerking** (very useful on its own): if $B$ has columns $\mathbf{b}_1,\dots,\mathbf{b}_n$, then
$$
AB = A\,(\mathbf{b}_1\ \mathbf{b}_2\ \cdots\ \mathbf{b}_n) = (A\mathbf{b}_1\ \ A\mathbf{b}_2\ \ \cdots\ \ A\mathbf{b}_n),
$$
i.e. **the $i$-th column of $AB$ is $A$ times the $i$-th column of $B$.**

So $AB = I$ means
$$
(A\mathbf{b}_1\ \cdots\ A\mathbf{b}_n) = (\mathbf{e}_1\ \cdots\ \mathbf{e}_n),
$$
where $\mathbf{e}_i$ are the **standaardbasisvectoren** of $\mathbb{R}^n$ (the columns of $I$).
To find $B = A^{-1}$ we must therefore solve **$n$ systems**, each with $n$ unknowns and $n$ equations:
$$
\boxed{A\mathbf{b}_1 = \mathbf{e}_1,\quad \dots,\quad A\mathbf{b}_n = \mathbf{e}_n.}
$$
By assumption 3 each of these has a **unique** solution $\mathbf{b}_i$. Put them side by side:
$B = (\mathbf{b}_1\ \cdots\ \mathbf{b}_n)$ is the unique matrix with $AB = I$. This proves 3 ⇒ 1 **and** Opmerking 2 (uniqueness). $\square$

#### Proof of 1 ⇒ 3

Assume $A$ is invertible. Look at $A\mathbf{x} = \mathbf{c}$.

1. $\mathbf{x} = A^{-1}\mathbf{c}$ **is** a solution: $A(A^{-1}\mathbf{c}) = (AA^{-1})\mathbf{c} = I\mathbf{c} = \mathbf{c}$.
2. It is the **only** one: if $A\mathbf{x} = \mathbf{c}$, multiply on the left by $A^{-1}$: $A^{-1}A\mathbf{x} = A^{-1}\mathbf{c}$, so $I\mathbf{x} = A^{-1}\mathbf{c}$, so $\mathbf{x} = A^{-1}\mathbf{c}$. $\square$

(This step uses $A^{-1}A = I$, i.e. Opmerking 1.)

#### Proof of Opmerking 1: $AB = I \Rightarrow BA = I$

Same trick as 3 ⇒ 1, but entered through statement 4.

- **Stap 1:** $B\mathbf{x} = \mathbf{0}$ has a unique solution.
  *Proof:* $B\mathbf{0} = \mathbf{0}$, so there is a solution. If $B\mathbf{x} = \mathbf{0}$ then $AB\mathbf{x} = A\mathbf{0} = \mathbf{0}$, and $AB = I$, so $\mathbf{x} = \mathbf{0}$. Unique.
- **Stap 2:** $B\mathbf{x} = \mathbf{c}$ has a unique solution for every $\mathbf{c}$.
  *Proof:* Conclusie 1, 4 ⇒ 3, applied to $B$ (Stap 1 is statement 4 with $\mathbf{c} = \mathbf{0}$).
- **Stap 3:** there is a matrix $C$ with $BC = I$. *Proof:* the proof of 3 ⇒ 1, applied to $B$.
- **Stap 4:** $C = A$. *Proof:* from $BC = I$: $ABC = AI = A$. But $AB = I$, so $ABC = IC = C$. Hence $C = A$, i.e. $BA = I$. $\square$

### 2.5 How to compute $A^{-1}$ in practice

Solve $A\mathbf{x} = \mathbf{e}_1,\dots,A\mathbf{x} = \mathbf{e}_n$ **simultaneously** with Gauss–Jordan on $(A\mid I)$.
When the left block has become $I$, the right block is $A^{-1}$.

**VB.** $A = \begin{pmatrix}2&1\\3&2\end{pmatrix}$.

$$
\left(\begin{array}{cc|cc} 2&1&1&0\\ 3&2&0&1\end{array}\right)
\xrightarrow{r_2\to r_2-\frac32 r_1}
\left(\begin{array}{cc|cc} 2&1&1&0\\ 0&\tfrac12&-\tfrac32&1\end{array}\right)
\xrightarrow{r_2\to 2r_2}
\left(\begin{array}{cc|cc} 2&1&1&0\\ 0&1&-3&2\end{array}\right)
$$
$$
\xrightarrow{r_1\to r_1-r_2}
\left(\begin{array}{cc|cc} 2&0&4&-2\\ 0&1&-3&2\end{array}\right)
\xrightarrow{r_1\to r_1/2}
\left(\begin{array}{cc|cc} 1&0&2&-1\\ 0&1&-3&2\end{array}\right)
$$

So $A^{-1} = \begin{pmatrix}2&-1\\-3&2\end{pmatrix}$. Check: $\begin{pmatrix}2&1\\3&2\end{pmatrix}\begin{pmatrix}2&-1\\-3&2\end{pmatrix} = \begin{pmatrix}4-3 & -2+2\\ 6-6 & -3+4\end{pmatrix} = I$. ✓

If during the reduction the left block gets a zero row, $A$ has fewer than $n$ pivots and **no inverse** (VB1 above would show this).

---

## 3. Lineaire deelruimten in $\mathbb{R}^n$ (§3.4)

**Def. 3.4.1.** A subset $W\subseteq\mathbb{R}^n$ is a **lineaire deelruimte** of $\mathbb{R}^n$ if

1. $\mathbf{x},\mathbf{y}\in W \Rightarrow \mathbf{x}+\mathbf{y}\in W$ ($W$ is **gesloten onder optelling**),
2. $\mathbf{x}\in W,\ \lambda\in\mathbb{R} \Rightarrow \lambda\mathbf{x}\in W$ (**gesloten onder scalaire vermenigvuldiging**),
3. $\mathbf{0}\in W$.

Lecture remarks on the slide:

- Condition 3 is automatic as soon as $W\neq\emptyset$ (take $\lambda = 0$ in condition 2). Its job is to exclude the empty set.
- **Pictures:** a line *not* through $\mathbf{0}$: **not** a subspace (fails 3). A shaded region/half-plane: **not** (fails 2, scaling leaves it). A line or plane **through $\mathbf{0}$**: **yes**.
- **How to prove the properties** — example: $W = \{\mathbf{x}\in\mathbb{R}^2 \mid A\mathbf{x} = \mathbf{0}\}$. Property 1: let $\mathbf{x},\mathbf{y}\in W$ be arbitrary. Then $A(\mathbf{x}+\mathbf{y}) = A\mathbf{x} + A\mathbf{y} = \mathbf{0}+\mathbf{0} = \mathbf{0}$, so $\mathbf{x}+\mathbf{y}\in W$. (Properties 2 and 3 go the same way: $A(\lambda\mathbf{x}) = \lambda A\mathbf{x} = \mathbf{0}$ and $A\mathbf{0} = \mathbf{0}$.) This set is the **nulruimte** $\mathrm{Nul}(A)$, Def. 3.4.7 / Voorbeeld 3.4.8.

### Opspansel / Span (Def. 3.4.3)

For vectors $\mathbf{v}_1,\dots,\mathbf{v}_r\in\mathbb{R}^n$:
$$
\mathrm{Span}(\mathbf{v}_1,\dots,\mathbf{v}_r) = \{\lambda_1\mathbf{v}_1 + \dots + \lambda_r\mathbf{v}_r \mid \lambda_1,\dots,\lambda_r\in\mathbb{R}\}
$$
= the set of all **lineaire combinaties** of $\mathbf{v}_1,\dots,\mathbf{v}_r$. A span is always a linear subspace (Stelling 3.4.4).

**VB.** All three of these are the **grondvlak** ($x_1x_2$-plane) in $\mathbb{R}^3$:
$$
\mathrm{Span}\!\left(\begin{pmatrix}1\\1\\0\end{pmatrix},\begin{pmatrix}0\\1\\0\end{pmatrix}\right)
= \mathrm{Span}\!\left(\begin{pmatrix}1\\2\\0\end{pmatrix},\begin{pmatrix}3\\0\\0\end{pmatrix}\right)
= \mathrm{Span}\!\left(\begin{pmatrix}1\\0\\0\end{pmatrix},\begin{pmatrix}0\\1\\0\end{pmatrix},\begin{pmatrix}1\\2\\0\end{pmatrix}\right).
$$
Any two *onafhankelijke* vectors in the plane span it; the third vector in the last
span is **overbodig** (redundant) "maar mag wel". Week 4 makes "redundant" precise.

---

## 4. De meetkunde van de oplossingsverzameling van $A\mathbf{x} = \mathbf{c}$ (§3.5)

Now $A\in M_{m,n}$, $\mathbf{x}\in\mathbb{R}^n$, $\mathbf{c}\in\mathbb{R}^m$.

**Def. 3.5.1.**
- $\mathbf{c} = \mathbf{0}$: the system is **homogeen**; solution set $S_{\mathrm{hom}} = \{\mathbf{x}\in\mathbb{R}^n \mid A\mathbf{x} = \mathbf{0}\}$ ($= \mathrm{Nul}(A)$).
- $\mathbf{c}\neq\mathbf{0}$: the system is **inhomogeen**; solution set $S_{\mathrm{inhom}} = \{\mathbf{x}\in\mathbb{R}^n \mid A\mathbf{x} = \mathbf{c}\}$.

**Opmerking (bewijs zelf):**
1. $S_{\mathrm{hom}}$ **is** a lineaire deelruimte of $\mathbb{R}^n$ (it is exactly the $W$ proved above).
2. $S_{\mathrm{inhom}}$ is **not** a lineaire deelruimte ($\mathbf{0}\notin S_{\mathrm{inhom}}$ since $A\mathbf{0} = \mathbf{0}\neq\mathbf{c}$).

### Stelling 3.5.3

Let $\mathbf{x}_0\in S_{\mathrm{inhom}}$ be one fixed solution (**any** solution will do — compare with the steunvector of a line/plane). Then
$$
\boxed{\;S_{\mathrm{inhom}} = \{\mathbf{x}_0 + \mathbf{y} \mid \mathbf{y}\in S_{\mathrm{hom}}\}\;}
$$

**Picture:** $S_{\mathrm{hom}}$ is a line/plane **through $\mathbf{0}$**; $S_{\mathrm{inhom}}$ is the same
line/plane **shifted** so that it passes through $\mathbf{x}_0$. This is exactly what you
saw in week 2 VB2/VB3: steunvector $+$ span of direction vectors.

**Bewijs** (set equality = two inclusions). Fix $\mathbf{x}_0\in S_{\mathrm{inhom}}$.

(a) $\{\mathbf{x}_0 + \mathbf{y} \mid \mathbf{y}\in S_{\mathrm{hom}}\}\subseteq S_{\mathrm{inhom}}$.
Let $\mathbf{y}\in S_{\mathrm{hom}}$ be arbitrary. Then $A(\mathbf{x}_0 + \mathbf{y}) = A\mathbf{x}_0 + A\mathbf{y} = \mathbf{c} + \mathbf{0} = \mathbf{c}$, so $\mathbf{x}_0 + \mathbf{y}\in S_{\mathrm{inhom}}$.

(b) $S_{\mathrm{inhom}}\subseteq\{\mathbf{x}_0 + \mathbf{y} \mid \mathbf{y}\in S_{\mathrm{hom}}\}$.
Let $\mathbf{z}\in S_{\mathrm{inhom}}$ be arbitrary. We show there is a $\mathbf{y}\in S_{\mathrm{hom}}$ with $\mathbf{z} = \mathbf{x}_0 + \mathbf{y}$. Look at
$A(\mathbf{z} - \mathbf{x}_0) = A\mathbf{z} - A\mathbf{x}_0 = \mathbf{c} - \mathbf{c} = \mathbf{0}$. So $\mathbf{z} - \mathbf{x}_0\in S_{\mathrm{hom}}$; call it $\mathbf{y}$. Then $\mathbf{z} = \mathbf{x}_0 + \mathbf{y}$ with $\mathbf{y}\in S_{\mathrm{hom}}$. $\square$

> **Practical consequence.** To describe all solutions of $A\mathbf{x} = \mathbf{c}$ you need
> (i) one particular solution $\mathbf{x}_0$ and (ii) the solutions of the homogeneous
> system. Gauss–Jordan on $(A\mid\mathbf{c})$ gives both at once: the constant vector is
> $\mathbf{x}_0$, the vectors multiplied by free parameters span $S_{\mathrm{hom}}$.

---

## Zelftest

1. $A\in M_{4,4}$ reduces to a matrix with 3 pivots. How many solutions can $A\mathbf{x} = \mathbf{b}$ have? Is $A$ invertible?
   *Answer:* either none or infinitely many (never exactly one). Not invertible (needs 4 pivots).
2. Why is "$B = 1/A$" bad notation? *Answer:* there is no division of matrices; $A^{-1}$ is defined by $AB = I$, and since $AB\neq BA$ in general one has to *prove* that $BA = I$ as well (Opmerking 1).
3. Find the inverse of $\begin{pmatrix}1&2\\2&5\end{pmatrix}$ with $(A\mid I)$.
   *Answer:* $r_2\to r_2-2r_1$: $\left(\begin{array}{cc|cc}1&2&1&0\\0&1&-2&1\end{array}\right)$; $r_1\to r_1-2r_2$: $\left(\begin{array}{cc|cc}1&0&5&-2\\0&1&-2&1\end{array}\right)$. So $A^{-1} = \begin{pmatrix}5&-2\\-2&1\end{pmatrix}$, matching VB2.
4. Is $\{(x_1,x_2)^t \mid x_1 + x_2 = 1\}$ a subspace of $\mathbb{R}^2$? *Answer:* no, $\mathbf{0}$ is not in it. (It is an $S_{\mathrm{inhom}}$.) Is $\{(x_1,x_2)^t \mid x_1 + x_2 = 0\}$? *Answer:* yes (an $S_{\mathrm{hom}}$).
5. In week 2 VB3 the solution set was $\mathbf{p} + s\mathbf{a} + t\mathbf{b} + u\mathbf{c}$. Identify $\mathbf{x}_0$ and $S_{\mathrm{hom}}$.
   *Answer:* $\mathbf{x}_0 = (1,0,-1,0,0)^t$, $S_{\mathrm{hom}} = \mathrm{Span}(\mathbf{a},\mathbf{b},\mathbf{c})$ with $\mathbf{a} = (-2,1,0,0,0)^t$, $\mathbf{b} = (-1,0,-2,1,0)^t$, $\mathbf{c} = (-1,0,-1,0,1)^t$.
