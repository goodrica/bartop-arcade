# Agent Instructions

## Project

A dependency-free HTML5 Canvas bartop arcade designed for a 17 inch landscape touchscreen. Photo Hunt is the primary working game.

## Read first

Read `README.md`, the engine, and the complete game module being changed. Preserve the standard game interface and touchscreen behavior.

## Run and verify

Serve locally with:

```bash
python3 -m http.server 8080
```

Test in a browser at the intended 1920 by 1080 landscape layout. Verify pointer coordinates, scaling, touch targets, timer behavior, scoring, penalties, cleanup, menu return, and audio initialization.

For Photo Hunt:

1. Differences should be slight but clearly noticeable.
2. Do not create microscopic, ambiguous, or unfair differences.
3. Confirm the left and right images remain aligned.
4. Confirm every marked difference matches the visible changed region.
5. Preserve source and licensed asset information.

## Safety and scope

Do not remove large image assets as unused without tracing level references. Do not publish, change GitHub Pages, or deploy without approval. Preserve unrelated games and shared engine behavior.

## Before stopping

Report changed games or assets, browsers and resolutions tested, visual checks not performed, blockers, and the exact next action.
