#!/bin/bash
# Usage: infinitesimaalrekening/build.sh — compiles src/infi.tex (pdflatex x2) into pdf/Infi-workbook-ch0-7.pdf
# Needs TeX Live with tcolorbox, tikz, needspace, mathptmx/helvet (texlive-latex-extra + texlive-fonts-recommended).
set -e
cd "$(dirname "$0")/src"
pdflatex -interaction=nonstopmode -halt-on-error infi.tex >/dev/null
pdflatex -interaction=nonstopmode -halt-on-error infi.tex >/dev/null
mv infi.pdf ../pdf/Infi-workbook-ch0-7.pdf
rm -f infi.aux infi.log infi.out infi.toc
echo "built pdf/Infi-workbook-ch0-7.pdf"
