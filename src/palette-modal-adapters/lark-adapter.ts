import { Notice, Instruction } from 'obsidian';
import {
    generateHotKeyText, PaletteMatch, SuggestModalAdapter,
} from 'src/utils';
import { Match } from 'src/types/types';
import { ActionType } from 'src/utils/constants';

export interface LarkDoc {
    title: string;
    url: string;
}

interface CoderidianPlugin {
    fetchLarkDocs(): Promise<LarkDoc[]>;
}

export default class BetterCommandPaletteLarkAdapter extends SuggestModalAdapter {
    titleText = 'Better Command Palette: Feishu Docs';

    emptyStateText = 'Loading Feishu documents...';

    private larkSearchPrefix: string;

    initialize(): void {
        super.initialize();

        this.larkSearchPrefix = this.plugin.settings.larkSearchPrefix;
        this.hiddenIds = this.plugin.settings.hiddenLarkDocs ?? [];
        this.hiddenIdsSettingsKey = 'hiddenLarkDocs';
        this.allItems = [];

        this.loadDocuments();
    }

    async loadDocuments(): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const coderidian = (this.app as any).plugins?.getPlugin?.('coderidian') as CoderidianPlugin | null;
        if (!coderidian || typeof coderidian.fetchLarkDocs !== 'function') {
            this.emptyStateText = 'Coderidian plugin is required for Feishu document search.';
            this.palette.updateSuggestions();
            return;
        }

        try {
            const docs = await coderidian.fetchLarkDocs();
            this.allItems = docs.map((d) => new PaletteMatch(d.url, d.title));
            this.emptyStateText = 'No matching Feishu documents.';
            this.palette.lastQuery = '\0';
            this.palette.updateSuggestions();
        } catch (e) {
            this.emptyStateText = `Failed to load: ${(e as Error).message}`;
            // eslint-disable-next-line no-new
            new Notice(`[BCP Lark] ${(e as Error).message}`);
            this.palette.lastQuery = '\0';
            this.palette.updateSuggestions();
        }
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
        ];
    }

    getInstructions(): Instruction[] {
        return [
            {
                command: generateHotKeyText({ modifiers: [], key: 'ENTER' }, this.plugin.settings),
                purpose: 'Open in browser',
            },
        ];
    }

    cleanQuery(query: string): string {
        return query.startsWith(this.larkSearchPrefix)
            ? query.slice(this.larkSearchPrefix.length).trimStart()
            : query;
    }

    renderSuggestion(match: Match, content: HTMLElement): void {
        content.createEl('div', { cls: 'suggestion-title', text: match.text });
        content.createEl('div', { cls: 'suggestion-note', text: match.id });
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async onChooseSuggestion(match: Match, _event: MouseEvent | KeyboardEvent): Promise<void> {
        if (!match) return;
        window.open(match.id, '_blank');
    }
}
