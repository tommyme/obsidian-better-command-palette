# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development build with watch mode (outputs to test-vault/)
npm run dev

# Production build (outputs to dist/)
npm run build

# Local install build
npm run build-local

# Lint
npm run test:lint

# End-to-end tests (watch mode)
npm run test:e2e

# Generate test files
npm run tool:gen-files
```

## Architecture

This is an Obsidian plugin that replaces the built-in command palette with a multi-modal search interface.

### Core Flow

User input → `BetterCommandPaletteModal` (palette.ts) → prefix detection → adapter selection → Web Worker fuzzy search → rendered results

### Key Components

**`src/main.ts`** — Plugin entry point. Registers 4 commands (main palette, file-search, tag-search, omnisearch), manages macro commands dynamically, and spawns the Web Worker.

**`src/palette.ts`** — The main `SuggestModal` subclass. Routes input to the correct adapter based on prefix characters, handles all keyboard shortcuts (Backspace-to-close, Cmd+Enter for new tab, Mod+I to toggle hidden items, Mod+L to paste file path), and manages adapter lifecycle (mount/unmount on prefix change).

**`src/settings.ts`** — Settings data model and `SettingTab` UI. Manages 16+ settings including macro definitions, file/tag prefixes, hotkey style, and hidden items per search mode.

**`src/web-workers/suggestions-worker.ts`** — Background thread using `fuzzysort` for non-blocking fuzzy search. Supports `||` OR queries and `@tag` filtering.

### Adapter Pattern

`src/palette-modal-adapters/suggest-modal-adapter.ts` defines the abstract base. Each concrete adapter implements:
- `initialize()` — loads items on first use
- `getSortedItems()` — returns items with recent/pinned ordering
- `renderSuggestion()` / `onChooseSuggestion()` — display and selection logic
- `cleanQuery()` — strips mode prefix from raw input

Adapters: `command-adapter` (Obsidian commands + macros), `file-adapter` (open/create files), `tag-adapter` (tag-based file search), `note-search-adapter` (OmniSearch full-text), `prompt-template-adapter`.

### Adding a New Search Mode

1. Create a new adapter in `src/palette-modal-adapters/` extending `SuggestModalAdapter`
2. Export it from `src/palette-modal-adapters/index.ts`
3. Add a prefix constant to `src/utils/constants.ts`
4. Register it in `palette.ts` adapter selection logic
5. Optionally register a dedicated command in `main.ts`

### Unsafe Interfaces

The plugin accesses private Obsidian APIs via `UnsafeAppInterface` and `UnsafeSuggestModalInterface` defined in `src/types/types.d.ts`. These bypass TypeScript type safety and may break on Obsidian updates.

### Recent/Pinned Ordering

`src/utils/ordered-set.ts` maintains insertion-ordered sets used to track recently used items. `getSortedItems()` in each adapter applies sorting to put recent/pinned items at top (configurable via settings).
