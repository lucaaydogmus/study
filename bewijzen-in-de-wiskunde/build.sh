#!/bin/bash
# Usage: bewijzen-in-de-wiskunde/build.sh — compiles both documents (pdflatex x2 each) into pdf/
#   src/wb.tex    -> pdf/BiW-workbook-ch0-2-from-book.pdf   (built from the book pages; authoritative)
#   src/guide.tex -> pdf/BiW-study-guide-ch0-5.pdf          (older guide written without the book)
# Needs TeX Live with tcolorbox, tikz, needspace, mathptmx/helvet (texlive-latex-extra + texlive-fonts-recommended).
set -e
cd "$(dirname "$0")/src"
for pair in "wb:BiW-workbook-ch0-2-from-book" "guide:BiW-study-guide-ch0-5"; do
  tex="${pair%%:*}"; out="${pair##*:}"
  pdflatex -interaction=nonstopmode -halt-on-error "$tex.tex" >/dev/null
  pdflatex -interaction=nonstopmode -halt-on-error "$tex.tex" >/dev/null
  mv "$tex.pdf" "../pdf/$out.pdf"
  rm -f "$tex.aux" "$tex.log" "$tex.out" "$tex.toc"
  echo "built pdf/$out.pdf"
done
