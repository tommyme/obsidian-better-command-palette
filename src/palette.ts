import { App, setIcon, SuggestModal } from 'obsidian';
import {
    generateHotKeyText,
    OrderedSet, PaletteMatch, renderPrevItems, SuggestModalAdapter,
} from 'src/utils';
import { Match, UnsafeSuggestModalInterface } from 'src/types/types';
import {
    BetterCommandPaletteCommandAdapter,
    BetterCommandPaletteFileAdapter,
    BetterCommandPaletteTagAdapter,
} from 'src/palette-modal-adapters';
import BetterCommandPalettePlugin from 'src/main';
import { ActionType } from './utils/constants';

class BetterCommandPaletteModal extends SuggestModal<Match> implements UnsafeSuggestModalInterface {
    // Unsafe interface
    chooser: UnsafeSuggestModalInterface['chooser'];

    updateSuggestions: UnsafeSuggestModalInterface['updateSuggestions'];

    plugin: BetterCommandPalettePlugin;

    actionType: ActionType;

    fileSearchPrefix: string;

    tagSearchPrefix: string;

    suggestionsWorker: Worker;

    currentSuggestions: Match[];

    lastQuery: string;

    modalTitleEl: HTMLElement;

    hiddenItemsHeaderEl: HTMLElement;

    showHiddenItems: boolean;

    initialInputValue: string;

    commandAdapter: BetterCommandPaletteCommandAdapter;

    fileAdapter: BetterCommandPaletteFileAdapter;

    tagAdapter: BetterCommandPaletteTagAdapter;

    currentAdapter: SuggestModalAdapter;

    suggestionLimit: number;

    constructor(
        app: App,
        prevCommands: OrderedSet<Match>,
        prevTags: OrderedSet<Match>,
        plugin: BetterCommandPalettePlugin,
        suggestionsWorker: Worker,
        initialInputValue = '',
    ) {
        super(app);

        // General instance variables
        this.fileSearchPrefix = plugin.settings.fileSearchPrefix;
        this.tagSearchPrefix = plugin.settings.tagSearchPrefix;
        this.suggestionLimit = plugin.settings.suggestionLimit;
        this.initialInputValue = initialInputValue;

        this.plugin = plugin;

        this.modalEl.addClass('better-command-palette');

        // The only time the input will be empty will be when we are searching commands
        this.setPlaceholder('Select a command');

        // Set up all of our different adapters
        this.commandAdapter = new BetterCommandPaletteCommandAdapter(
            app,
            prevCommands,
            plugin,
            this,
        );
        this.fileAdapter = new BetterCommandPaletteFileAdapter(
            app,
            new OrderedSet<Match>(),
            plugin,
            this,
        );
        this.tagAdapter = new BetterCommandPaletteTagAdapter(
            app,
            prevTags,
            plugin,
            this,
        );

        // Lets us do the suggestion fuzzy search in a different thread
        this.suggestionsWorker = suggestionsWorker;
        this.suggestionsWorker.onmessage = (msg: MessageEvent) => this.receivedSuggestions(msg);

        // Add our custom title element
        this.modalTitleEl = createEl('p', {
            cls: 'better-command-palette-title',
        });

        // Update our action type before adding in our title element so the text is correct
        this.updateActionType();

        // Add in the title element
        this.modalEl.insertBefore(this.modalTitleEl, this.modalEl.firstChild);

        this.hiddenItemsHeaderEl = createEl('p', 'hidden-items-header');
        this.showHiddenItems = false;

        this.hiddenItemsHeaderEl.onClickEvent(this.toggleHiddenItems);

        this.modalEl.insertBefore(this.hiddenItemsHeaderEl, this.resultContainerEl);

        // Set our scopes for the modal
        this.setScopes(plugin);
    }

    close(evt?: KeyboardEvent) {
        super.close();

        if (evt) {
            evt.preventDefault();
        }
    }

    setScopes(plugin: BetterCommandPalettePlugin) {
        const closeModal = (event: KeyboardEvent) => {
            // Have to cast this to access `value`
            const el = event.target as HTMLInputElement;

            if (plugin.settings.closeWithBackspace && el.value === '') {
                this.close(event);
            }
        };

        const { createNewPaneMod, createNewFileMod } = plugin.settings;

        // 注册键盘事件
        this.scope.register([], 'Backspace', (event: KeyboardEvent) => {
            closeModal(event);
        });

        this.scope.register(['Mod'], 'Backspace', (event: KeyboardEvent) => {
            closeModal(event);
        });

        this.scope.register([createNewFileMod], 'Enter', (event: KeyboardEvent) => {
            if (this.actionType === ActionType.Files) {
                this.currentAdapter.onChooseSuggestion(null, event);
                this.close(event);
            }
        });

        this.scope.register([createNewFileMod, createNewPaneMod], 'Enter', (event: KeyboardEvent) => {
            if (this.actionType === ActionType.Files) {
                this.currentAdapter.onChooseSuggestion(null, event);
                this.close(event);
            }
        });

        this.scope.register([createNewPaneMod], 'Enter', (event: KeyboardEvent) => {
            if (this.actionType === ActionType.Files && this.currentSuggestions.length) {
                this.currentAdapter
                    .onChooseSuggestion(this.currentSuggestions[this.chooser.selectedItem], event);
                this.close(event);
            }
        });

        this.scope.register(['Mod'], 'I', this.toggleHiddenItems);

        this.scope.register(['Mod'], 'L', (event: KeyboardEvent) => {
            if (this.actionType === ActionType.Files && this.currentSuggestions.length) {
                // 这里由于api限制, 只能更改为第一项建议的路径值, 也就是说目前没有方法得到is-selected的元素
                // 又不是不能用...
                (this.currentAdapter as BetterCommandPaletteFileAdapter)!
                    .pasteSelected(this.currentSuggestions[this.chooser.selectedItem], event);
            }
        });
    }

    toggleHiddenItems = () => {
        this.showHiddenItems = !this.showHiddenItems;
        this.updateSuggestions();
    };

    onOpen() {
        super.onOpen();

        // Add the initial value to the input
        // TODO: Figure out if there is a way to bypass the first seach
        // result flickering before this is set
        // As far as I can tell onOpen resets the value of the input so this is the first place
        if (this.initialInputValue) {
            this.setQuery(this.initialInputValue);
        }
    }

    changeActionType(actionType:ActionType) {
        let prefix = '';
        if (actionType === ActionType.Files) {
            prefix = this.plugin.settings.fileSearchPrefix;
        } else if (actionType === ActionType.Tags) {
            prefix = this.plugin.settings.tagSearchPrefix;
        }
        const currentQuery: string = this.inputEl.value;
        const cleanQuery = this.currentAdapter.cleanQuery(currentQuery);

        this.inputEl.value = prefix + cleanQuery;
        this.updateSuggestions();
    }

    setQuery(
        newQuery: string,
        cursorPosition: number = -1,
    ) {
        this.inputEl.value = newQuery;

        if (cursorPosition > -1) {
            this.inputEl.setSelectionRange(cursorPosition, cursorPosition);
        }

        this.updateSuggestions();
    }

    updateActionType() : boolean {
        const text: string = this.inputEl.value;
        let nextAdapter;
        let type;

        if (text.startsWith(this.fileSearchPrefix)) {
            type = ActionType.Files;
            nextAdapter = this.fileAdapter;
        } else if (text.startsWith(this.tagSearchPrefix)) {
            type = ActionType.Tags;
            nextAdapter = this.tagAdapter;
        } else {
            type = ActionType.Commands;
            nextAdapter = this.commandAdapter;
        }

        if (type !== this.actionType) {
            this.currentAdapter?.unmount();
            this.currentAdapter = nextAdapter;
            this.currentAdapter.mount();
        }

        if (!this.currentAdapter.initialized) {
            this.currentAdapter.initialize();
        }

        const wasUpdated = type !== this.actionType;
        this.actionType = type;

        if (wasUpdated) {
            this.updateEmptyStateText();
            this.updateTitleText();
            this.updateInstructions();
            this.currentSuggestions = this.currentAdapter
                .getSortedItems()
                .slice(0, this.suggestionLimit);
        }

        return wasUpdated;
    }

    updateTitleText() {
        if (this.plugin.settings.showPluginName) {
            this.modalTitleEl.setText(this.currentAdapter.getTitleText());
        } else {
            this.modalTitleEl.setText('');
        }
    }

    updateEmptyStateText() {
        this.emptyStateText = this.currentAdapter.getEmptyStateText();
    }

    updateInstructions() {
        Array.from(this.modalEl.getElementsByClassName('prompt-instructions'))
            .forEach((instruction) => {
                this.modalEl.removeChild(instruction);
            });

        this.setInstructions([
            ...this.currentAdapter.getInstructions(),
            { command: generateHotKeyText({ modifiers: [], key: 'ESC' }, this.plugin.settings), purpose: 'Close palette' },
            { command: generateHotKeyText({ modifiers: ['Mod'], key: 'I' }, this.plugin.settings), purpose: 'Toggle Hidden Items' },
        ]);
    }

    getItems(): Match[] {
        return this.currentAdapter.getSortedItems();
    }

    receivedSuggestions(msg : MessageEvent) {
        const results = [];
        let hiddenCount = 0;

        for (
            let i = 0;
            i < msg.data.length && results.length < this.suggestionLimit + hiddenCount;
            i += 1
        ) {
            results.push(msg.data[i]);

            if (this.currentAdapter.hiddenIds.includes(msg.data[i].id)) {
                hiddenCount += 1;
            }
        }

        const matches = results.map((r : Match) => new PaletteMatch(r.id, r.text, r.tags));

        // Sort the suggestions so that previously searched items are first
        const prevItems = this.currentAdapter.getPrevItems();
        matches.sort((a, b) => (+prevItems.has(b)) - (+prevItems.has(a)));

        this.currentSuggestions = matches;
        this.limit = this.currentSuggestions.length;
        this.updateSuggestions();
    }

    getSuggestionsAsync(query: string) {
        const items = this.getItems();
        this.suggestionsWorker.postMessage({
            query,
            items,
        });
    }

    getSuggestions(query: string): Match[] {
        // The action type might have changed
        this.updateActionType();

        const getNewSuggestions = query !== this.lastQuery;
        this.lastQuery = query;
        const fixedQuery = this.currentAdapter.cleanQuery(query.trim());

        if (getNewSuggestions) {
            // Load suggestions in another thread
            this.getSuggestionsAsync(fixedQuery);
        }

        const visibleItems = this.currentSuggestions.filter(
            (match) => !this.currentAdapter.hiddenIds.includes(match.id),
        );

        const hiddenItemCount = this.currentSuggestions.length - visibleItems.length;

        this.updateHiddenItemCountHeader(hiddenItemCount);

        // For now return what we currently have. We'll populate results later if we need to
        return this.showHiddenItems ? this.currentSuggestions : visibleItems;
    }

    updateHiddenItemCountHeader(hiddenItemCount: number) {
        this.hiddenItemsHeaderEl.empty();

        if (hiddenItemCount !== 0) {
            const text = `${this.showHiddenItems ? 'Hide' : 'Show'} hidden items (${hiddenItemCount})`;
            this.hiddenItemsHeaderEl.setText(text);
        }
    }

    renderSuggestion(match: Match, el: HTMLElement) {
        el.addClass('mod-complex');

        const isHidden = this.currentAdapter.hiddenIds.includes(match.id);

        if (isHidden) {
            el.addClass('hidden');
        }

        const icon = 'cross';

        const suggestionContent = el.createEl('span', 'suggestion-content');
        const suggestionAux = el.createEl('span', 'suggestion-aux');

        const flairContainer = suggestionAux.createEl('span', 'suggestion-flair');
        renderPrevItems(match, suggestionContent, this.currentAdapter.getPrevItems());

        setIcon(flairContainer, icon, 13);
        flairContainer.ariaLabel = isHidden ? 'Click to Unhide' : 'Click to Hide';
        flairContainer.setAttr('data-id', match.id);

        flairContainer.onClickEvent((event) => {
            event.preventDefault();
            event.stopPropagation();

            const hideEl = event.target as HTMLElement;

            this.currentAdapter.toggleHideId(hideEl.getAttr('data-id'));
        });

        this.currentAdapter.renderSuggestion(match, suggestionContent, suggestionAux);
    }

    async onChooseSuggestion(item: Match, event: MouseEvent | KeyboardEvent) {
        this.currentAdapter.onChooseSuggestion(item, event);
    }
}

export default BetterCommandPaletteModal;
