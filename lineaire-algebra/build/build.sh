#!/bin/bash
# Usage: build/build.sh — converts each lesson .md into pdf/<name>.pdf (pandoc -> LaTeX -> pdflatex x2)
set -e
export LC_ALL=C.UTF-8
cd "$(dirname "$0")/.."
declare -A TITLES=(
  [README]="Lineaire Algebra H1–4: Overzicht"
  [week1-H1-H2-vectoren-en-inproduct]="Week 1 – Hoofdstuk 1 & 2: Vectoren, lijnen, vlakken en het inproduct"
  [week2-H3.1-3.2-matrices-en-gauss-jordan]="Week 2 – §3.1 & 3.2: Matrices en Gauss–Jordan"
  [week3-H3.3-3.5-inverse-deelruimten-oplossingsverzameling]="Week 3 – §3.3–3.5: Inverse, deelruimten en de oplossingsverzameling"
  [week4-H4.1-4.2-afhankelijkheid-rang-basis]="Week 4 – §4.1 & 4.2: Afhankelijkheid, rang, dimensie en basis"
)
for f in README week1-H1-H2-vectoren-en-inproduct week2-H3.1-3.2-matrices-en-gauss-jordan \
         week3-H3.3-3.5-inverse-deelruimten-oplossingsverzameling week4-H4.1-4.2-afhankelijkheid-rang-basis; do
  src="$f.md"; tmp="build/$f.pre.md"; tex="build/$f.tex"
  # drop the H1 line (title comes from metadata); replace symbols LaTeX can't typeset; point links at the PDFs
  sed -e '1{/^# /d}' -e 's/⚠/**Let op:**/g' -e 's/↑/^/g' -e 's/\.md)/.pdf)/g' "$src" > "$tmp"
  pandoc "$tmp" -o "$tex" --standalone \
    --from=markdown+tex_math_dollars+pipe_tables --shift-heading-level-by=-1 \
    -H build/preamble.tex --toc --toc-depth=1 \
    -V documentclass=article -V fontsize=11pt -V papersize=a4 -V geometry:margin=2.3cm \
    -V colorlinks -V linkcolor=accent -V urlcolor=accent -V toccolor=accent \
    -M title="${TITLES[$f]}" -M subtitle="Studiegids uit de HC-aantekeningen (dictaat-nummers ter referentie)" \
    -M lang=en
  (cd build && pdflatex -interaction=nonstopmode -halt-on-error "$f.tex" >/dev/null && pdflatex -interaction=nonstopmode -halt-on-error "$f.tex" >/dev/null)
  mv "build/$f.pdf" "pdf/$f.pdf"
  echo "built pdf/$f.pdf  ($(grep -c 'Overfull \\hbox' build/$f.log) overfull boxes)"
done
rm -f build/*.aux build/*.out build/*.toc build/*.pre.md
