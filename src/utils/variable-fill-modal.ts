import {
    App,
    Modal,
    Setting,
    TFile,
} from 'obsidian';
import BetterCommandPaletteModal from 'src/palette';
import { OrderedSet } from 'src/utils';
import { Match } from 'src/types/types';

export interface TemplateVar {
    name: string;
    type: 'text' | 'file' | 'current';
}

export class VariableFillModal extends Modal {
    private vars: TemplateVar[];

    private values: Record<string, string> = {};

    private onSubmit: (values: Record<string, string>) => void;

    constructor(app: App, vars: TemplateVar[], onSubmit: (values: Record<string, string>) => void) {
        super(app);
        this.vars = vars;
        this.onSubmit = onSubmit;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h3', { text: 'Fill in template variables' });

        this.vars.forEach((v) => {
            this.values[v.name] = '';
            const setting = new Setting(contentEl).setName(v.name);

            if (v.type === 'file') {
                const display = setting.controlEl.createEl('span', {
                    text: '(no file selected)',
                    cls: 'setting-item-description',
                });
                setting.addButton((btn) => btn
                    .setButtonText('Browse...')
                    .onClick(() => {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const plugin = (this.app as any).plugins?.plugins?.['obsidian-better-command-palette'];
                        if (!plugin) return;

                        const picker = new BetterCommandPaletteModal(
                            this.app,
                            new OrderedSet<Match>(),
                            new OrderedSet<Match>(),
                            plugin,
                            plugin.suggestionsWorker,
                            plugin.settings.fileSearchPrefix,
                        );

                        picker.setFileChooseCallback((item, evt) => {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const adapter = this.app.vault.adapter as any;
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const fileAdapter = picker.fileAdapter as any;
                            const path = fileAdapter.getPathFromSelection(item, evt);
                            this.values[v.name] = adapter.getFullPath(path);
                            display.setText(path);
                        });

                        picker.open();
                    }));
            } else if (v.type === 'current') {
                // Find the most recently focused file tab.
                // 1) getActiveFile() works when a file leaf has focus
                // 2) getMostRecentLeaf() covers tab-switch without "open" (may be non-file)
                // 3) getLeavesOfType('markdown') as last resort
                const getFile = (): TFile | null => {
                    const direct = this.app.workspace.getActiveFile();
                    if (direct) return direct;
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const recent = this.app.workspace.getMostRecentLeaf();
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const recentFile = (recent?.view as any)?.file;
                    if (recentFile instanceof TFile) return recentFile;
                    const mdLeaves = this.app.workspace.getLeavesOfType('markdown');
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const mdFile = (mdLeaves[0]?.view as any)?.file;
                    return mdFile instanceof TFile ? mdFile : null;
                };
                const activeFile = getFile();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const adapter = this.app.vault.adapter as any;
                if (activeFile instanceof TFile) {
                    this.values[v.name] = adapter.getFullPath(activeFile.path);
                    setting.controlEl.createEl('span', {
                        text: activeFile.path,
                        cls: 'setting-item-description',
                    });
                } else {
                    this.values[v.name] = '';
                    setting.controlEl.createEl('span', {
                        text: '(no active file)',
                        cls: 'setting-item-description',
                    });
                }
            } else {
                setting.addText((text) => {
                    text.setPlaceholder(v.name).onChange((val) => { this.values[v.name] = val; });
                    text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                        if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
                    });
                });
            }
        });

        new Setting(contentEl)
            .addButton((btn) => btn
                .setButtonText('Send to Claude')
                .setCta()
                .onClick(() => this.submit()));
    }

    submit(): void {
        this.close();
        this.onSubmit(this.values);
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
