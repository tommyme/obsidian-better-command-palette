import { Instruction, TFile } from 'obsidian';
import {
    generateHotKeyText,
    PaletteMatch,
    SuggestModalAdapter,
} from 'src/utils';
import { Match } from 'src/types/types';
import { ActionType } from 'src/utils/constants';

/**
 * Adapter for full-text note search via the OmniSearch plugin.
 * Triggered by the noteSearchPrefix (default: '?').
 *
 * - Empty query ('?'): shows recently opened files (same as FileAdapter behaviour)
 * - Query with text ('?obsidian'): calls window.omnisearch.search() which uses
 *   BM25 scoring, fuzzy matching, field weighting, and recency boost.
 *
 * OmniSearch is an optional dependency. If it is not installed the adapter
 * shows an explanatory empty-state message and does not throw.
 */
export default class BetterCommandPaletteNoteSearchAdapter extends SuggestModalAdapter {
    titleText: string;

    emptyStateText: string;

    initialize() {
        super.initialize();

        this.titleText = 'Better Command Palette: Note Search';
        this.emptyStateText = window.omnisearch
            ? 'No matching notes found.'
            : 'OmniSearch plugin is not installed or not yet indexed.';

        this.hiddenIds = this.plugin.settings.hiddenNotes;
        this.hiddenIdsSettingsKey = 'hiddenNotes';

        // No static allItems — search results are fetched dynamically via OmniSearch.
        // prevItems (recently opened files) are used when the query is empty.
        this.allItems = [];

        // Mirror FileAdapter: use Obsidian's last-open-files list as "recent" items.
        [...this.app.workspace.getLastOpenFiles()].reverse().forEach((filePath) => {
            this.prevItems.add(new PaletteMatch(filePath, this.fileBasename(filePath)));
        });
    }

    mount(): void {
        // Register hotkeys that switch away from this mode to others.
        this.keymapHandlers = [
            this.palette.scope.register(
                ['Mod'],
                this.plugin.settings.commandSearchHotkey,
                () => this.palette.changeActionType(ActionType.Commands),
            ),
            this.palette.scope.register(
                ['Mod'],
                this.plugin.settings.fileSearchHotkey,
                () => this.palette.changeActionType(ActionType.Files),
            ),
            this.palette.scope.register(
                ['Mod'],
                this.plugin.settings.tagSearchHotkey,
                () => this.palette.changeActionType(ActionType.Tags),
            ),
        ];
    }

    getInstructions(): Instruction[] {
        return [
            { command: generateHotKeyText({ modifiers: [], key: 'ENTER' }, this.plugin.settings), purpose: 'Open note' },
            { command: generateHotKeyText({ modifiers: ['Mod'], key: this.plugin.settings.commandSearchHotkey }, this.plugin.settings), purpose: 'Search Commands' },
            { command: generateHotKeyText({ modifiers: ['Mod'], key: this.plugin.settings.fileSearchHotkey }, this.plugin.settings), purpose: 'Search Files' },
            { command: generateHotKeyText({ modifiers: ['Mod'], key: this.plugin.settings.tagSearchHotkey }, this.plugin.settings), purpose: 'Search Tags' },
        ];
    }

    cleanQuery(query: string): string {
        return query.replace(this.plugin.settings.noteSearchPrefix, '').trim();
    }

    /**
     * Custom async search that bypasses the BCP Web Worker.
     * Called by palette.ts instead of posting to the Worker when this adapter is active.
     *
     * - Empty query → return recently opened files (getSortedItems from prevItems)
     * - Non-empty query → delegate to window.omnisearch.search()
     */
    async searchAsync(query: string): Promise<Match[]> {
        if (!query) {
            // Show recent files when no search term is entered
            return this.getSortedItems();
        }

        if (!window.omnisearch) {
            return [];
        }

        try {
            const results = await window.omnisearch.search(query);
            // Store the excerpt in tags[0] so renderSuggestion can display it.
            // (tags[] is not used for Worker-side filtering here since we bypass the Worker.)
            return results.map((r) => new PaletteMatch(r.path, r.basename, [r.excerpt]));
        } catch {
            return [];
        }
    }

    renderSuggestion(match: Match, content: HTMLElement): void {
        content.createEl('div', {
            cls: 'suggestion-title',
            text: match.text,
        });

        // tags[0] holds the excerpt text (set in searchAsync)
        if (match.tags[0]) {
            content.createEl('div', {
                cls: 'suggestion-note',
                text: match.tags[0],
            });
        }
    }

    async onChooseSuggestion(match: Match): Promise<void> {
        if (!match) return;

        this.getPrevItems().add(match);

        const file = this.app.vault.getAbstractFileByPath(match.id);
        if (file instanceof TFile) {
            await this.app.workspace.getLeaf().openFile(file);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private fileBasename(path: string): string {
        const name = path.split('/').pop() ?? path;
        return name.endsWith('.md') ? name.slice(0, -3) : name;
    }
}
