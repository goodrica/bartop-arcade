/* ============================================
   Bartop Arcade - Photo Hunt pair index
   ============================================
   GENERATED FILE - do not edit by hand.
   Regenerate with:  python3 scripts/prepare_manual_edits.py

   A pair is listed only when:
     assets/photos/<base>__edited.jpg exists AND differs from <base>.jpg
     assets/photos/<base>__mods.json has 5 diffs with x/y coordinates

   Play order is alphabetical, except for photos named in
   assets/photos/edit-priority.json, which are listed first.
   Level 1 is the first entry below.
   ============================================ */

export const PHOTO_PAIRS = [
  { base: 'vehicles__truck', modified: 'vehicles__truck__edited' },
  { base: 'animals__dog', modified: 'animals__dog__edited' },
  { base: 'food__burger', modified: 'food__burger__edited' },
  { base: 'purchased__sierra-mountains', modified: 'purchased__sierra-mountains__edited' },
  { base: 'purchased__tennis-girls', modified: 'purchased__tennis-girls__edited' },
  { base: 'vehicles__classic-car', modified: 'vehicles__classic-car__edited' },
];

/** 6 playable pair(s) out of 98 base photos. */
export const PAIR_COUNT = PHOTO_PAIRS.length;
