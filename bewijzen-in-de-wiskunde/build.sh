#!/bin/bash
# Usage: bewijzen-in-de-wiskunde/build.sh — compiles the documents (pdflatex x2 each) into pdf/
#   src/wb05.tex  -> pdf/BiW-workbook-ch0-5.pdf     (main document: chapters 0-5, built from the book)
#   src/guide.tex -> pdf/BiW-study-guide-ch0-5.pdf  (older guide written without the book)
# Needs TeX Live with tcolorbox, tikz, needspace, mathptmx/helvet (texlive-latex-extra + texlive-fonts-recommended).
set -e
cd "$(dirname "$0")/src"
for pair in "wb05:BiW-workbook-ch0-5" "guide:BiW-study-guide-ch0-5"; do
  tex="${pair%%:*}"; out="${pair##*:}"
  pdflatex -interaction=nonstopmode -halt-on-error "$tex.tex" >/dev/null
  pdflatex -interaction=nonstopmode -halt-on-error "$tex.tex" >/dev/null
  mv "$tex.pdf" "../pdf/$out.pdf"
  rm -f "$tex.aux" "$tex.log" "$tex.out" "$tex.toc"
  echo "built pdf/$out.pdf"
done
