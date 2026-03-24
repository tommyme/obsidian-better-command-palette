/**
 * A floating help panel that:
 * - stays on top (z-index) but does NOT block interaction with the editor
 * - does not close when clicking outside
 * - has selectable text
 * - is draggable via the title bar
 * - has a close button
 */
export default class FloatingHelpPanel {
    private el: HTMLElement;

    constructor() {
        this.el = this.build();
    }

    open(): void {
        document.body.appendChild(this.el);
    }

    close(): void {
        this.el.remove();
    }

    private build(): HTMLElement {
        const panel = createEl('div', { cls: 'bcp-float-panel' });

        // Resize handles (8 directions)
        this.makeResizable(panel);

        // Title bar
        const titleBar = panel.createDiv({ cls: 'bcp-float-panel-titlebar' });
        titleBar.createSpan({ cls: 'bcp-float-panel-title', text: 'Better Command Palette Help' });

        const closeBtn = titleBar.createEl('button', {
            cls: 'bcp-float-panel-close',
            text: '✕',
        });
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.addEventListener('click', () => this.close());

        // Content area
        const body = panel.createDiv({ cls: 'bcp-float-panel-body' });
        body.innerHTML = this.getHelpContent();

        // Drag behaviour
        this.makeDraggable(panel, titleBar);

        return panel;
    }

    private getHelpContent(): string {
        return `
            <h3>Prompt Template Variables</h3>
            <p>Use variables in your prompt templates to create interactive templates:</p>
            <table>
                <tr><th>Syntax</th><th>Type</th><th>Behavior</th></tr>
                <tr><td><code>{{variable}}</code></td><td>text</td><td>Shows a text input field</td></tr>
                <tr><td><code>{{file:variable}}</code></td><td>file</td><td>Shows "Browse..." button to select a file via BCP file picker</td></tr>
                <tr><td><code>{{current:variable}}</code></td><td>current</td><td>Auto-fills with the currently active file path (read-only)</td></tr>
            </table>

            <h3>Example Template</h3>
            <pre><code>Translate the following file to Chinese:

Source: {{file:source}}
Target: {{current:target}}

Please translate the content above.</code></pre>

            <h3>Keyboard Shortcuts</h3>
            <ul>
                <li><code>Ctrl+Shift+P</code> - Open BCP</li>
                <li><code>Ctrl+Shift+F</code> - Open OmniSearch</li>
                <li><code>Enter</code> - Open file / Use template</li>
                <li><code>Ctrl+Enter</code> - Open in new tab</li>
                <li><code>Backspace</code> - Close palette (when input empty)</li>
            </ul>
        `;
    }

    private anchorToRect(panel: HTMLElement, rect: DOMRect): void {
        const { style } = panel;
        style.right = 'unset';
        style.left = `${rect.left}px`;
        style.top = `${rect.top}px`;
        style.width = `${rect.width}px`;
        style.height = `${rect.height}px`;
    }

    private makeDraggable(panel: HTMLElement, handle: HTMLElement): void {
        handle.addEventListener('mousedown', (e: MouseEvent) => {
            if ((e.target as HTMLElement).closest('.bcp-float-panel-close')) return;
            e.preventDefault();

            const rect = panel.getBoundingClientRect();
            this.anchorToRect(panel, rect);

            const startX = e.clientX;
            const startY = e.clientY;
            const originLeft = rect.left;
            const originTop = rect.top;

            const onMove = (me: MouseEvent) => {
                const { style } = panel;
                style.left = `${originLeft + me.clientX - startX}px`;
                style.top = `${originTop + me.clientY - startY}px`;
            };
            const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
            };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }

    private makeResizable(panel: HTMLElement): void {
        const dirs = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;

        dirs.forEach((dir) => {
            const handle = panel.createDiv({
                cls: `bcp-float-resizer bcp-float-resizer-${dir}`,
            });

            handle.addEventListener('mousedown', (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();

                const rect = panel.getBoundingClientRect();
                this.anchorToRect(panel, rect);

                const startX = e.clientX;
                const startY = e.clientY;
                const {
                    left, top, width, height,
                } = rect;
                const MIN_W = 300;
                const MIN_H = 200;

                const onMove = (me: MouseEvent) => {
                    const dx = me.clientX - startX;
                    const dy = me.clientY - startY;
                    const { style } = panel;

                    if (dir.includes('e')) {
                        style.width = `${Math.max(MIN_W, width + dx)}px`;
                    }
                    if (dir.includes('w')) {
                        const newW = Math.max(MIN_W, width - dx);
                        style.width = `${newW}px`;
                        style.left = `${left + width - newW}px`;
                    }
                    if (dir.includes('s')) {
                        style.height = `${Math.max(MIN_H, height + dy)}px`;
                    }
                    if (dir.includes('n')) {
                        const newH = Math.max(MIN_H, height - dy);
                        style.height = `${newH}px`;
                        style.top = `${top + height - newH}px`;
                    }
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
        });
    }
}
