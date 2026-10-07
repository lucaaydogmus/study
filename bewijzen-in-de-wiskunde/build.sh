#!/bin/bash
# Usage: bewijzen-in-de-wiskunde/build.sh — compiles src/guide.tex (pdflatex x2) into pdf/BiW-study-guide-ch0-5.pdf
# Needs TeX Live with tcolorbox, tikz, needspace, mathptmx/helvet (texlive-latex-extra + texlive-fonts-recommended).
set -e
cd "$(dirname "$0")/src"
pdflatex -interaction=nonstopmode -halt-on-error guide.tex >/dev/null
pdflatex -interaction=nonstopmode -halt-on-error guide.tex >/dev/null
mv guide.pdf ../pdf/BiW-study-guide-ch0-5.pdf
rm -f guide.aux guide.log guide.out guide.toc
echo "built pdf/BiW-study-guide-ch0-5.pdf"
