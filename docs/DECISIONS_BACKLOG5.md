# Decisions and Notes for Backlog 5

This document tracks decisions made while executing tasks from Backlog 5.

## Task 6: Code Health
- **Goal**: ESLint + Prettier in CI, split `src/game/main.ts` into feature modules (mostly composition), remove dead code and stale probe scripts.
- **Notes**: Starting this first.

### Decision: Splitting main.ts
- Created src/game/setup/ directory to hold feature modules for initializing various parts of the engine.
- Will create graphics.ts, audio.ts, ui.ts, input.ts, encounters.ts to organize the god-function into compositional blocks.
- This will make main.ts act purely as the orchestrator of these modules, making the animation loop and dependencies clear.

## Task 5: Loading and Error Screens
- **Goal**: Implement loading and error screens (zone-load progress, missing data errors, WebGPU fallback).
- **Decisions**:
  - Added a splash screen div in game.html over the canvas.
  - Wrapped main.ts setup in a try...catch that routes uncaught startup errors into the UI splash screen (friendly error display).
  - Updated the data fetching to throw a friendlier error if KRONDOR.RMF and .001 are missing.
  - In travelTo(), we show the splash screen with "Loading Zone ..." before zoneHost.switchTo, waiting one frame to allow DOM rendering.
  - After startup, if the backend is WebGL2, we show the in-game toast informing the user about the WebGL2 fallback.
