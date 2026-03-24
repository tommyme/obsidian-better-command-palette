import {
    Instruction, Notice, TFile, TFolder,
} from 'obsidian';
import {
    generateHotKeyText, PaletteMatch, SuggestModalAdapter,
} from 'src/utils';
import { Match } from 'src/types/types';
import { ActionType } from 'src/utils/constants';
import { TemplateVar, VariableFillModal } from 'src/utils/variable-fill-modal';

function collectMdFiles(folder: TFolder): TFile[] {
    const results: TFile[] = [];
    folder.children.forEach((child) => {
        if (child instanceof TFile && child.extension === 'md') {
            results.push(child);
        } else if (child instanceof TFolder) {
            collectMdFiles(child).forEach((f) => results.push(f));
        }
    });
    return results;
}

export default class BetterCommandPalettePromptTemplateAdapter extends SuggestModalAdapter {
    titleText = 'Better Command Palette: Prompt Templates';

    emptyStateText = 'No matching templates. Configure "Prompt Templates Folder" in settings.';

    private promptTemplateSearchPrefix: string;

    initialize() {
        super.initialize();

        this.promptTemplateSearchPrefix = this.plugin.settings.promptTemplateSearchPrefix;
        this.hiddenIds = this.plugin.settings.hiddenPromptTemplates;
        this.hiddenIdsSettingsKey = 'hiddenPromptTemplates';
        this.allItems = [];

        const folderPath = this.plugin.settings.promptTemplatesFolder?.trim();
        if (!folderPath) return;

        const abstract = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(abstract instanceof TFolder)) return;

        const folder = abstract;
        this.allItems = collectMdFiles(folder).map((file) => {
            // id = full vault path (for lookup), text = relative path without .md (for display)
            const rel = file.path.slice(folder.path.length + 1).replace(/\.md$/, '');
            return new PaletteMatch(file.path, rel);
        });
    }

    mount(): void {
        this.keymapHandlers = [
            this.palette.scope.register(['Mod'], this.plugin.settings.commandSearchHotkey, () => this.palette.changeActionType(ActionType.Commands)),
            this.palette.scope.register(['Mod'], this.plugin.settings.fileSearchHotkey, () => this.palette.changeActionType(ActionType.Files)),
            this.palette.scope.register(['Mod'], this.plugin.settings.tagSearchHotkey, () => this.palette.changeActionType(ActionType.Tags)),
            this.palette.scope.register(['Mod'], this.plugin.settings.noteSearchHotkey, () => this.palette.changeActionType(ActionType.NoteSearch)),
        ];
    }

    getInstructions(): Instruction[] {
        return [
            { command: generateHotKeyText({ modifiers: [], key: 'ENTER' }, this.plugin.settings), purpose: 'Use template' },
        ];
    }

    cleanQuery(query: string): string {
        return query.replace(this.promptTemplateSearchPrefix, '');
    }

    renderSuggestion(match: Match, content: HTMLElement): void {
        content.createEl('div', { cls: 'suggestion-title', text: match.text });
        if (match.tags.length > 0) {
            content.createEl('div', { cls: 'suggestion-note', text: match.tags.join(' ') });
        }
    }

    async onChooseSuggestion(match: Match): Promise<void> {
        this.getPrevItems().add(match);

        const file = this.app.vault.getAbstractFileByPath(match.id);
        if (!(file instanceof TFile)) {
            // eslint-disable-next-line no-new
            new Notice(`Template file not found: ${match.id}`);
            return;
        }

        const rawContent = await this.app.vault.read(file);

        // Parse {{variable}}, {{file:variable}}, {{current:variable}} placeholders, deduped
        const placeholderRegex = /\{\{(file:|current:)?([^}]+)\}\}/g;
        const seen = new Set<string>();
        const vars: TemplateVar[] = [];
        Array.from(rawContent.matchAll(placeholderRegex)).forEach((m) => {
            const type = m[1] ? m[1].slice(0, -1) : 'text';
            const name = m[2].trim();
            const key = `${type}:${name}`;
            if (!seen.has(key)) {
                seen.add(key);
                vars.push({ name, type: type as 'text' | 'file' | 'current' });
            }
        });

        const doSend = (values: Record<string, string>) => {
            let filled = rawContent;
            vars.forEach((v) => {
                let placeholder = `{{${v.name}}}`;
                if (v.type === 'file') placeholder = `{{file:${v.name}}}`;
                else if (v.type === 'current') placeholder = `{{current:${v.name}}}`;
                // Use split/join for compatibility with older TS lib targets (no replaceAll)
                filled = filled.split(placeholder).join(values[v.name] ?? '');
            });
            this.sendToClaudeSidebar(filled);
        };

        if (vars.length === 0) {
            doSend({});
        } else {
            const modal = new VariableFillModal(this.app, vars, doSend);
            modal.open();
        }
    }

    private sendToClaudeSidebar(text: string): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const claudeSidebar = (this.app as any).plugins?.plugins?.['claude-sidebar'];
        if (claudeSidebar?.sendTextToTerminal) {
            claudeSidebar.sendTextToTerminal(`${text}\n`);
        } else {
            // eslint-disable-next-line no-new
            new Notice('Claude Sidebar plugin not found or not active.');
        }
    }
}
