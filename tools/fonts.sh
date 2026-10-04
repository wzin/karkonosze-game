#!/bin/sh
# Copies the Fraunces and Nunito webfonts from @fontsource into public/fonts/.
# Both subsets are needed: "latin" holds ASCII (and o-acute), "latin-ext" holds the other Polish letters.
set -eu
cd "$(dirname "$0")/.."

src=node_modules/@fontsource
out=public/fonts
mkdir -p "$out"

for subset in latin latin-ext; do
  for weight in 500 700 900; do
    cp "$src/fraunces/files/fraunces-$subset-$weight-normal.woff2" "$out/"
  done
  for weight in 400 600 700 800; do
    cp "$src/nunito/files/nunito-$subset-$weight-normal.woff2" "$out/"
  done
done

cp "$src/fraunces/LICENSE" "$out/OFL-Fraunces.txt"
cp "$src/nunito/LICENSE" "$out/OFL-Nunito.txt"

echo "fonts copied to $out"
