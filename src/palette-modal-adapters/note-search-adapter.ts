import { Instruction, TFile } from 'obsidian';
import {
    ensureMainWorkspaceLeaf,
    generateHotKeyText,
    PaletteMatch,
    SuggestModalAdapter,
} from 'src/utils';
import { Match } from 'src/types/types';
import { ActionType } from 'src/utils/constants';

/**
 * Adapter for full-text note search.
 * Triggered by the noteSearchPrefix (default: '?').
 *
 * Two search engines, toggled with Mod+F:
 *  - OmniSearch (default): BM25 via window.omnisearch.search()
 *  - Built-in:             scans all vault markdown files for text matches
 *
 * Result tags layout: tags[0] = excerpt text, tags[1..] = words to highlight.
 *
 * - Empty query ('?'): shows recently opened files
 * - Query with text:   delegates to the active engine
 */
export default class BetterCommandPaletteNoteSearchAdapter extends SuggestModalAdapter {
    titleText: string;

    emptyStateText: string;

    private useNativeSearch = false;

    initialize() {
        super.initialize();

        this.titleText = 'Better Command Palette: Note Search';
        this.emptyStateText = window.omnisearch
            ? 'No matching notes found.'
            : 'OmniSearch not installed — press ⌘F to use built-in search.';

        this.hiddenIds = this.plugin.settings.hiddenNotes;
        this.hiddenIdsSettingsKey = 'hiddenNotes';

        this.allItems = [];

        [...this.app.workspace.getLastOpenFiles()].reverse().forEach((filePath) => {
            this.prevItems.add(new PaletteMatch(filePath, this.fileBasename(filePath)));
        });
    }

    getTitleText(): string {
        return `Better Command Palette: Note Search (${this.useNativeSearch ? 'Built-in' : 'OmniSearch'})`;
    }

    getEmptyStateText(): string {
        if (this.useNativeSearch) return 'No matching notes found.';
        return window.omnisearch
            ? 'No matching notes found.'
            : 'OmniSearch not installed — press ⌘F to switch to built-in search.';
    }

    mount(): void {
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
            this.palette.scope.register(['Mod'], 'F', () => {
                this.useNativeSearch = !this.useNativeSearch;
                // Reset lastQuery so getSuggestions fires a fresh async search
                this.palette.lastQuery = '';
                this.palette.updateTitleText();
                this.palette.updateEmptyStateText();
                this.palette.updateSuggestions();
            }),
        ];
    }

    getInstructions(): Instruction[] {
        return [
            { command: generateHotKeyText({ modifiers: [], key: 'ENTER' }, this.plugin.settings), purpose: 'Open note' },
            { command: generateHotKeyText({ modifiers: [this.plugin.settings.createNewPaneMod], key: 'ENTER' }, this.plugin.settings), purpose: 'Open in new tab' },
            { command: generateHotKeyText({ modifiers: ['Mod'], key: 'F' }, this.plugin.settings), purpose: 'Toggle OmniSearch / Built-in' },
            { command: generateHotKeyText({ modifiers: ['Mod'], key: this.plugin.settings.commandSearchHotkey }, this.plugin.settings), purpose: 'Search Commands' },
            { command: generateHotKeyText({ modifiers: ['Mod'], key: this.plugin.settings.fileSearchHotkey }, this.plugin.settings), purpose: 'Search Files' },
            { command: generateHotKeyText({ modifiers: ['Mod'], key: this.plugin.settings.tagSearchHotkey }, this.plugin.settings), purpose: 'Search Tags' },
        ];
    }

    cleanQuery(query: string): string {
        return query.replace(this.plugin.settings.noteSearchPrefix, '').trim();
    }

    async searchAsync(query: string): Promise<Match[]> {
        if (!query) return this.getSortedItems();

        if (this.useNativeSearch) return this.nativeFileSearch(query);

        if (!window.omnisearch) return [];

        try {
            const results = await window.omnisearch.search(query);
            // tags[0] = excerpt, tags[1..] = foundWords for highlighting
            return results.map(
                (r) => new PaletteMatch(r.path, r.basename, [r.excerpt, ...r.foundWords]),
            );
        } catch {
            return [];
        }
    }

    renderSuggestion(match: Match, content: HTMLElement): void {
        // tags[0] = excerpt, tags[1..] = words to highlight
        const excerpt = match.tags[0];
        const words = match.tags.slice(1);

        const titleEl = content.createEl('div', { cls: 'suggestion-title' });
        if (words.length) {
            titleEl.innerHTML = this.highlightText(match.text, words);
        } else {
            titleEl.setText(match.text);
        }

        if (excerpt) {
            const excerptEl = content.createEl('div', { cls: 'suggestion-note' });
            if (words.length) {
                excerptEl.innerHTML = this.highlightText(excerpt, words);
            } else {
                excerptEl.setText(excerpt);
            }
        }
    }

    async onChooseSuggestion(match: Match, event: MouseEvent | KeyboardEvent): Promise<void> {
        if (!match) return;

        this.getPrevItems().add(match);

        const file = this.app.vault.getAbstractFileByPath(match.id);
        if (!(file instanceof TFile)) return;

        // tags[1] is the first foundWord from OmniSearch (or first query token from native search)
        const searchWord = match.tags[1];
        let targetLine: number | undefined;

        if (searchWord) {
            try {
                const content = await this.app.vault.cachedRead(file);
                const idx = content.toLowerCase().indexOf(searchWord.toLowerCase());
                if (idx !== -1) {
                    targetLine = content.substring(0, idx).split('\n').length - 1;
                }
            } catch {
                // ignore — fall back to opening at top
            }
        }

        const createNewTab = this.plugin.settings.createNewPaneMod === 'Shift'
            ? event.shiftKey
            : event.metaKey;
        if (createNewTab) {
            (this.app as any).commands.executeCommandById('workspace:new-tab');
        }

        // Switch away from sidebar before opening
        ensureMainWorkspaceLeaf(this.app);

        const openState = targetLine !== undefined ? { eState: { line: targetLine } } : {};
        this.app.workspace.activeLeaf.openFile(file, openState);
    }

    // ── private helpers ───────────────────────────────────────────────────────

    /**
     * Simple full-text scan over all vault markdown files.
     * tags[0] = excerpt, tags[1..] = query tokens for highlighting.
     */
    private async nativeFileSearch(query: string): Promise<Match[]> {
        const files = this.app.vault.getMarkdownFiles();
        const lowerQuery = query.toLowerCase();
        const queryWords = query.split(/\s+/).filter(Boolean);

        const settled = await Promise.all(
            files.map(async (file) => {
                try {
                    const content = await this.app.vault.cachedRead(file);
                    const lowerContent = content.toLowerCase();
                    const idx = lowerContent.indexOf(lowerQuery);
                    if (idx === -1) return null;

                    const start = Math.max(0, idx - 60);
                    const end = Math.min(content.length, idx + query.length + 60);
                    const excerpt = `...${content.substring(start, end).replace(/\n/g, ' ')}...`;

                    return new PaletteMatch(file.path, file.basename, [excerpt, ...queryWords]);
                } catch {
                    return null;
                }
            }),
        );

        return settled.filter((r): r is PaletteMatch => r !== null);
    }

    /**
     * Wraps occurrences of `words` inside `text` with <span class="suggestion-highlight">.
     * HTML-escapes the text first to prevent injection.
     */
    private highlightText(text: string, words: string[]): string {
        const safe = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        if (!words.length) return safe;

        const pattern = words
            .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');

        return safe.replace(
            new RegExp(`(${pattern})`, 'giu'),
            '<span class="suggestion-highlight">$1</span>',
        );
    }

    private fileBasename(path: string): string {
        const name = path.split('/').pop() ?? path;
        return name.endsWith('.md') ? name.slice(0, -3) : name;
    }
}
