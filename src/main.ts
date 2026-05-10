import { Plugin } from 'obsidian';

import SuggestionsWorker from 'web-worker:./web-workers/suggestions-worker';
import { OrderedSet, MacroCommand, PaletteMatch } from 'src/utils';
import BetterCommandPaletteModal from 'src/palette';
import { Match, UnsafeAppInterface } from 'src/types/types';
import { BetterCommandPalettePluginSettings, BetterCommandPaletteSettingTab, DEFAULT_SETTINGS } from 'src/settings';
import { MACRO_COMMAND_ID_PREFIX } from './utils/constants';
import FloatingHelpPanel from './utils/floating-help-panel';
import './styles.scss';

const USAGE_DATA_PATH = '.obsidian/better-command-palette-usage.json';
const MAX_PERSISTED_ITEMS = 100;

interface UsageData {
    commands: Array<{ id: string; text: string; tags: string[] }>;
    tags: Array<{ id: string; text: string; tags: string[] }>;
    counts: Record<string, number>;
}

export default class BetterCommandPalettePlugin extends Plugin {
    app: UnsafeAppInterface;

    settings: BetterCommandPalettePluginSettings;

    prevCommands: OrderedSet<Match>;

    prevTags: OrderedSet<Match>;

    usageCounts: Map<string, number>;

    suggestionsWorker: Worker;

    async onload() {
        // eslint-disable-next-line no-console
        console.log('Loading plugin: Better Command Palette');

        await this.loadSettings();

        this.prevCommands = new OrderedSet<Match>();
        this.prevTags = new OrderedSet<Match>();
        this.usageCounts = new Map<string, number>();
        await this.loadUsageData();

        this.suggestionsWorker = new SuggestionsWorker({});

        this.addCommand({
            id: 'open-better-commmand-palette',
            name: 'Open better command palette',
            // Generally I would not set a hotkey, but since it is a
            // command palette I think it makes sense
            // Can still be overwritten in the hotkey settings
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'p' }],
            callback: () => {
                new BetterCommandPaletteModal(
                    this.app,
                    this.prevCommands,
                    this.prevTags,
                    this,
                    this.suggestionsWorker,
                ).open();
            },
        });

        this.addCommand({
            id: 'open-better-commmand-palette-file-search',
            name: 'Open better command palette: File Search',
            hotkeys: [],
            callback: () => {
                new BetterCommandPaletteModal(
                    this.app,
                    this.prevCommands,
                    this.prevTags,
                    this,
                    this.suggestionsWorker,
                    this.settings.fileSearchPrefix,
                ).open();
            },
        });

        this.addCommand({
            id: 'open-better-commmand-palette-tag-search',
            name: 'Open better command palette: Tag Search',
            hotkeys: [],
            callback: () => {
                new BetterCommandPaletteModal(
                    this.app,
                    this.prevCommands,
                    this.prevTags,
                    this,
                    this.suggestionsWorker,
                    this.settings.tagSearchPrefix,
                ).open();
            },
        });

        this.addCommand({
            id: 'open-better-commmand-palette-omnisearch',
            name: 'Open better command palette: Omnisearch',
            hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'f' }],
            callback: () => {
                new BetterCommandPaletteModal(
                    this.app,
                    this.prevCommands,
                    this.prevTags,
                    this,
                    this.suggestionsWorker,
                    this.settings.noteSearchPrefix,
                ).open();
            },
        });

        this.addSettingTab(new BetterCommandPaletteSettingTab(this.app, this));

        this.addCommand({
            id: 'show-better-command-palette-help',
            name: 'Show Better Command Palette Help',
            hotkeys: [],
            callback: () => {
                new FloatingHelpPanel().open();
            },
        });
    }

    onunload(): void {
        this.suggestionsWorker.terminate();
    }

    private async loadUsageData(): Promise<void> {
        try {
            const raw = await this.app.vault.adapter.read(USAGE_DATA_PATH);
            const data: UsageData = JSON.parse(raw);

            (data.commands || []).forEach((item) => {
                this.prevCommands.add(new PaletteMatch(item.id, item.text, item.tags || []));
            });
            (data.tags || []).forEach((item) => {
                this.prevTags.add(new PaletteMatch(item.id, item.text, item.tags || []));
            });
            Object.entries(data.counts || {}).forEach(([id, count]) => {
                this.usageCounts.set(id, count as number);
            });
        } catch (e) {
            // File doesn't exist yet on first run — start fresh
        }
    }

    async saveUsageData(): Promise<void> {
        try {
            const data: UsageData = {
                commands: this.prevCommands.values()
                    .slice(-MAX_PERSISTED_ITEMS)
                    .map((m) => ({ id: m.id, text: m.text, tags: m.tags })),
                tags: this.prevTags.values()
                    .slice(-MAX_PERSISTED_ITEMS)
                    .map((m) => ({ id: m.id, text: m.text, tags: m.tags })),
                counts: Object.fromEntries(
                    Array.from(this.usageCounts.entries())
                        .sort((a, b) => b[1] - a[1])
                        .slice(0, MAX_PERSISTED_ITEMS),
                ),
            };
            await this.app.vault.adapter.write(USAGE_DATA_PATH, JSON.stringify(data));
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('[BCP] saveUsageData: FAILED to save', e);
        }
    }

    recordUsage(match: Match, isTag: boolean): void {
        if (isTag) {
            this.prevTags.add(match);
        } else {
            this.prevCommands.add(match);
        }
        this.usageCounts.set(match.id, (this.usageCounts.get(match.id) || 0) + 1);
    }

    getUsageCount(id: string): number {
        return this.usageCounts.get(id) || 0;
    }

    loadMacroCommands() {
        this.settings.macros.forEach((macroData, index) => {
            if (!macroData.name || !macroData.commandIds.length) {
                return;
            }

            const macro = new MacroCommand(
                this.app,
                `${MACRO_COMMAND_ID_PREFIX}${index}`,
                macroData.name,
                macroData.commandIds,
                macroData.delay,
            );

            this.addCommand(macro);

            if (this.prevCommands) {
                this.prevCommands = this.prevCommands.values().reduce((acc, match) => {
                    if (match.id === macro.id && match.text !== macro.name) return acc;

                    acc.add(match);

                    return acc;
                }, new OrderedSet<Match>());
            }
        });
    }

    deleteMacroCommands() {
        const macroCommandIds = Object.keys(this.app.commands.commands)
            .filter((id) => id.includes(MACRO_COMMAND_ID_PREFIX));

        macroCommandIds.forEach((id) => {
            this.app.commands.removeCommand(id);
        });
    }

    async loadSettings() {
        this.settings = { ...DEFAULT_SETTINGS, ...await this.loadData() };
        this.loadMacroCommands();
    }

    async saveSettings() {
        this.deleteMacroCommands();
        await this.saveData(this.settings);
        this.loadMacroCommands();
    }
}
