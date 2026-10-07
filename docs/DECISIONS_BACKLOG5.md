# Decisions and Notes for Backlog 5

This document tracks decisions made while executing tasks from Backlog 5.

## Task 6: Code Health
- **Goal**: ESLint + Prettier in CI, split `src/game/main.ts` into feature modules (mostly composition), remove dead code and stale probe scripts.
- **Notes**: Starting this first.

### Decision: Splitting main.ts
- Created src/game/setup/ directory to hold feature modules for initializing various parts of the engine.
- Will create graphics.ts, audio.ts, ui.ts, input.ts, encounters.ts to organize the god-function into compositional blocks.
- This will make main.ts act purely as the orchestrator of these modules, making the animation loop and dependencies clear.
