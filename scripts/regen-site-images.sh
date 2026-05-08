#!/bin/bash
#
# Regenerate non-product site imagery via Higgsfield Nano Banana Pro.
#
# All 10 images live in the same Wetherill Park yard universe so the site
# feels like a single shoot. Brand-style preamble baked into every prompt
# for cohesion.
#
# Re-runnable: existing images are backed up to *.before-regen on first run
# only; subsequent runs overwrite the live file but preserve the original
# backup. Each image costs 2 credits (Nano Banana Pro).
#
# Usage:
#   bash scripts/regen-site-images.sh                    # generate everything
#   bash scripts/regen-site-images.sh hero-bulk          # generate one
#
set -e
cd "$(dirname "$0")/.."

BRAND="Photorealistic, 35mm DSLR look, soft golden-hour Sydney afternoon light. Same Wetherill Park trade-yard universe as our other shots — visual continuity. Western Sydney context, gum trees, native plants, branded utes with logos obscured. Real workers in high-vis vests or earth-toned workwear, unposed, workmanlike pride. Earthy palette of sage greens, terracotta, taupe, dry-grass yellow. No text, no readable signs or logos in frame."

generate() {
  local key=$1
  local target_path=$2
  local target_w=$3
  local target_h=$4
  local aspect=$5
  local scene_prompt=$6

  # Allow filtering: bash regen-site-images.sh hero-bulk
  if [ -n "$ONLY" ] && [ "$ONLY" != "$key" ]; then return 0; fi

  echo ""
  echo "════════════════════════════════════════"
  echo "  $key → $target_path ($target_w×$target_h)"
  echo "════════════════════════════════════════"

  local full_prompt="$BRAND $scene_prompt"
  echo "Aspect: $aspect · 2k · Pro (2 credits)"

  local url
  url=$(higgsfield generate create nano_banana_2 \
    --prompt "$full_prompt" \
    --aspect_ratio "$aspect" \
    --resolution "2k" \
    --wait --wait-timeout 6m 2>&1 | grep -E '^https://' | tail -1)

  if [[ ! "$url" =~ ^https:// ]]; then
    echo "✗ ERROR: no URL returned for $key"
    return 1
  fi

  echo "✓ Generated: $url"

  local stem
  stem=$(basename "$target_path" .jpg)
  local tmp_png="/tmp/regen-${stem}.png"
  local tmp_jpg="/tmp/regen-${stem}.jpg"

  curl -sL "$url" -o "$tmp_png"

  # Crop centred to exact target, then re-encode JPG q82
  sips -c "$target_h" "$target_w" "$tmp_png" --out "$tmp_png" >/dev/null 2>&1
  sips -s format jpeg -s formatOptions 82 "$tmp_png" --out "$tmp_jpg" >/dev/null 2>&1

  # Backup original on first run only
  if [ -f "$target_path" ] && [ ! -f "${target_path}.before-regen" ]; then
    cp "$target_path" "${target_path}.before-regen"
  fi

  cp "$tmp_jpg" "$target_path"
  local size_kb
  size_kb=$(ls -la "$target_path" | awk '{ printf "%0.0f", $5/1024 }')
  echo "✓ Saved: $target_path (${size_kb} KB)"
}

ONLY="${1:-}"

# ──────────────────────────────────────────────────────
# Homepage mid-section bulk-bags callout — wider catalogue feel
# ──────────────────────────────────────────────────────
generate "hero-bulk" "images/hero/hero-bulk.jpg" 1500 844 "16:9" \
  "Wide cinematic shot of a long row of filled white 1-tonne bulk bags inside the Wetherill Park trade yard — bags variously holding dark garden soil, golden hardwood mulch, decorative white pebbles, and grey river gravel — neatly lined up under the afternoon sun, ready for dispatch. Yellow forklift in the mid-ground lifting one of the bags, a worker in a high-vis safety vest walking past with a clipboard. Concrete bay walls separating the material stockpiles, gravel yard floor, corrugated industrial shed in the background, gum trees on the edges. Premium scale, organised operation."

# ──────────────────────────────────────────────────────
# Contact page — yard entrance, welcoming vibe
# ──────────────────────────────────────────────────────
generate "hero-contact" "images/hero/hero-contact.jpg" 1920 700 "21:9" \
  "Wide cinematic shot of the Wetherill Park landscape supply yard's entrance gate. A worker in high-vis safety vest stands by the open gate waving in greeting toward a tradesman pulling up in a workmanlike ute. Material stockpiles and a row of full white 1-tonne bulk bags visible inside the fenced compound behind them. Corrugated metal industrial shed in the background, gum trees framing the scene, sealed driveway. Warm welcoming feel, family-business approachability, soft late afternoon golden light."

# ──────────────────────────────────────────────────────
# FAQ page — helpful, informational
# ──────────────────────────────────────────────────────
generate "hero-faq" "images/hero/hero-faq.jpg" 1920 700 "21:9" \
  "Wide cinematic shot inside the same Wetherill Park yard. A landscaper in earth-toned workwear stands beside a stockpile of dark garden soil, gesturing to it as they explain something to a customer in casual clothes who is listening attentively and nodding. Both workers face roughly toward camera (three-quarter angle), trustworthy and helpful body language. Mulch piles and white pebble stockpile visible in the background, concrete bay walls, fenced trade yard. Educational, informational, warm afternoon sun."

# ──────────────────────────────────────────────────────
# Trade page — commercial scale, professional crew
# ──────────────────────────────────────────────────────
generate "hero-trade" "images/hero/hero-trade.jpg" 1920 700 "21:9" \
  "Wide cinematic shot of a larger commercial landscaping job at a Western Sydney development site. Three landscape contractors in matching high-vis safety vests and hard hats stand around a stack of multiple 1-tonne bulk bags being staged, examining a printed plan together. A loaded ute and a small bobcat loader nearby. Newly built brick homes with terracotta roofs in the background, freshly graded earth in the foreground. Premium operation, professional crew, late afternoon golden light."

# ──────────────────────────────────────────────────────
# Products page — catalogue feel, no people
# ──────────────────────────────────────────────────────
generate "hero-products" "images/hero/hero-products.jpg" 1920 700 "21:9" \
  "Wide cinematic shot of the Wetherill Park trade yard at golden hour with no people in frame. Four large neatly maintained material stockpiles arranged side-by-side, each separated by concrete bay walls — dark rich garden soil on the left, golden hardwood mulch beside it, decorative white snow pebbles next, then grey river gravel on the right. A row of full white 1-tonne bulk bags ready for delivery in the foreground. Corrugated industrial shed and gum trees in the background. Premium organised catalogue feel, calm late afternoon stillness."

# ──────────────────────────────────────────────────────
# About page — family business, generations
# ──────────────────────────────────────────────────────
generate "hero-about" "images/hero/hero-about.jpg" 1200 700 "16:9" \
  "Cinematic three-quarter shot of two members of a Sydney family-owned landscape supply business at the Wetherill Park yard — an older man in his fifties in earth-toned workwear with sleeves rolled up, and his adult son in a high-vis vest, standing side-by-side beside a stockpile of dark garden soil. Genuine smiles, looking out across the yard together with shared pride. Concrete bay walls, white 1-tonne bulk bags, corrugated shed in the background. Warm late afternoon Sydney sunlight, generations-of-experience feel."

# ──────────────────────────────────────────────────────
# Delivery hero — used on 66 suburb pages, focus on the delivery moment
# ──────────────────────────────────────────────────────
generate "hero-delivery" "images/hero/hero-delivery.jpg" 1920 700 "21:9" \
  "Wide cinematic shot of a delivery moment in a Western Sydney suburban driveway. A workmanlike branded delivery truck (logos obscured) is backed in next to a single-storey brick home, a 1-tonne bulk bag of dark garden soil being lowered onto the driveway by a small crane arm or hi-ab truck. The driver in a high-vis safety vest signals to the homeowner who watches from a few metres away. Suburban context — terracotta-tile roofs, gum trees, native garden, manicured lawn next door. Late afternoon golden hour, warm domestic feel."

# ──────────────────────────────────────────────────────
# Open Graph share image (1.91:1) — generated 16:9, cropped to 1200×630
# ──────────────────────────────────────────────────────
generate "og-image" "images/brand/og-image.jpg" 1200 630 "16:9" \
  "Brand-forward wide cinematic establishing shot of the Wetherill Park landscape supply yard at golden hour — composed for a horizontal social-share thumbnail. A worker in a high-vis vest stands proudly beside a stack of full white 1-tonne bulk bags in the foreground, with neat material stockpiles (soil, mulch, white pebbles, grey gravel) lined up behind. Corrugated industrial shed with gum trees and Western Sydney sky. Strong, premium, identifiable composition — content centred horizontally so it survives social-feed cropping."

# ──────────────────────────────────────────────────────
# Decorative on delivery-areas page — close-up material shot
# ──────────────────────────────────────────────────────
generate "bulk-river-gravel" "images/bulk/bulk-river-gravel.jpg" 800 500 "16:9" \
  "Close-up cinematic shot of a tidy stockpile of grey river gravel — smooth tumbled stones in greys and soft warm tans — at the Wetherill Park yard. Small white 1-tonne bulk bag tag visible on the edge of the pile. Soft warm late-afternoon light hitting the stones, shallow depth of field, sharp on the gravel grain. Premium decorative-stone catalogue feel."

echo ""
echo "════════════════════════════════════════"
echo "  Batch complete."
echo "════════════════════════════════════════"
higgsfield account status 2>&1 | head -3
