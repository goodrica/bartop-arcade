#!/usr/bin/env bash
# Download curated stock photos to assets/photos/ for offline use.
# Photos are CC0 via Picsum (Unsplash) — see README for attribution.
# Run once after cloning the repo, or to refresh the photo set.
set -euo pipefail

DEST="$(cd "$(dirname "$0")/../assets/photos" && pwd)"
mkdir -p "$DEST"

# Categories with curated seed lists (stable, photo content varies but reproducible)
CATEGORIES=(
  "animals:cat dog puppy fox panda tiger bird rabbit wolf bear horse elephant"
  "food:pizza sushi burger coffee cake pasta fruit bread salad wine"
  "nature:mountain forest ocean sunset lake desert waterfall beach autumn river"
  "cities:paris tokyo newyork london rome barcelona dubai singapore sydney istanbul"
  "objects:vintage camera book clock lamp phone guitar bicycle motorcycle shoes"
  "flowers:rose sunflower tulip lavender orchid daisy cherry lily jasmine peony"
  "vehicles:classic-car train plane boat sailboat helicopter truck scooter jeep"
  "space:galaxy nebula moon mars stars milky-way astronaut rocket eclipse saturn"
  "random:surprise1 surprise2 surprise3 surprise4 surprise5"
  "abstract:color texture pattern wave smoke glass metal water light shadow"
)

WIDTH=510
HEIGHT=900

count=0
for cat in "${CATEGORIES[@]}"; do
  name="${cat%%:*}"
  seeds="${cat#*:}"
  for seed in $seeds; do
    url="https://picsum.photos/seed/${seed}/${WIDTH}/${HEIGHT}"
    out="${DEST}/${name}__${seed}.jpg"
    if [[ -f "$out" && -s "$out" ]]; then
      echo "skip ${out##*/} (exists)"
      continue
    fi
    if curl -sS -L --max-time 30 "$url" -o "$out" 2>/dev/null && [[ -s "$out" ]]; then
      echo "saved ${out##*/}"
      count=$((count + 1))
    else
      echo "FAILED: ${seed}" >&2
      rm -f "$out"
    fi
    # Small sleep to be nice to picsum
    sleep 0.1
  done
done

echo "Done. ${count} new photos downloaded to ${DEST}"
