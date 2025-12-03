import * as vscode from 'vscode';

interface ChatActivityProbeOptions {
    previewChars?: number;
}

/**
 * ChatActivityProbe
 * Debug helper that reveals every document/notebook Cursor touches while chatting.
 * Enabled only for diagnostics and logs everything to the console.
 */
export class ChatActivityProbe implements vscode.Disposable {
    private readonly previewChars: number;
    private disposables: vscode.Disposable[] = [];
    private started = false;

    constructor(options: ChatActivityProbeOptions = {}) {
        this.previewChars = options.previewChars ?? 400;
    }

    start(context: vscode.ExtensionContext) {
        if (this.started) {
            return;
        }

        this.started = true;
        console.log('[ChatActivityProbe] ✅ Enabled. Tracking Cursor chat activity events...');

        this.disposables.push(
            vscode.workspace.onDidOpenTextDocument(doc => this.logTextEvent('onDidOpenTextDocument', doc)),
            vscode.workspace.onDidCloseTextDocument(doc => this.logTextEvent('onDidCloseTextDocument', doc)),
            vscode.workspace.onDidChangeTextDocument(event => {
                this.logTextEvent('onDidChangeTextDocument', event.document, {
                    contentChanges: event.contentChanges.length,
                    range: event.contentChanges[0]?.range
                });
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (!editor) {
                    console.log('[ChatActivityProbe] onDidChangeActiveTextEditor → undefined');
                    return;
                }
                this.logTextEvent('onDidChangeActiveTextEditor', editor.document);
            }),
            vscode.workspace.onDidOpenNotebookDocument(notebook => this.logNotebookEvent('onDidOpenNotebookDocument', notebook)),
            vscode.workspace.onDidCloseNotebookDocument(notebook => this.logNotebookEvent('onDidCloseNotebookDocument', notebook)),
            vscode.workspace.onDidChangeNotebookDocument(event => this.logNotebookEvent('onDidChangeNotebookDocument', event.notebook, {
                metadataChanges: event.metadata,
                cellChanges: event.cellChanges?.length
            })),
            vscode.window.onDidChangeVisibleNotebookEditors(editors => {
                console.log('[ChatActivityProbe] onDidChangeVisibleNotebookEditors', {
                    editors: editors.map(editor => ({
                        notebookType: editor.notebook.notebookType,
                        viewColumn: editor.viewColumn,
                        uri: editor.notebook.uri.toString()
                    }))
                });
            })
        );

        context.subscriptions.push(this);
    }

    private logTextEvent(event: string, document: vscode.TextDocument, extra?: Record<string, unknown>) {
        const text = document.getText();
        const preview = this.buildPreview(text);
        console.log('[ChatActivityProbe]', event, {
            fileName: document.fileName,
            languageId: document.languageId,
            scheme: document.uri.scheme,
            uri: document.uri.toString(),
            lineCount: document.lineCount,
            isDirty: document.isDirty,
            eol: document.eol === vscode.EndOfLine.CRLF ? 'CRLF' : 'LF',
            preview,
            ...extra
        });
    }

    private logNotebookEvent(event: string, notebook: vscode.NotebookDocument, extra?: Record<string, unknown>) {
        const cellsPreview = notebook.getCells().slice(0, 5).map(cell => ({
            kind: vscode.NotebookCellKind[cell.kind],
            languageId: cell.document.languageId,
            textPreview: this.buildPreview(cell.document.getText())
        }));

        console.log('[ChatActivityProbe]', event, {
            notebookType: notebook.notebookType,
            uri: notebook.uri.toString(),
            cellCount: notebook.cellCount,
            metadataKeys: Object.keys(notebook.metadata || {}),
            cellsPreview,
            ...extra
        });
    }

    private buildPreview(content: string): { length: number; head: string; tail: string } {
        if (!content) {
            return { length: 0, head: '(empty)', tail: '(empty)' };
        }

        const head = content.substring(0, this.previewChars);
        const tail = content.length > this.previewChars
            ? content.substring(content.length - this.previewChars)
            : head;

        return {
            length: content.length,
            head,
            tail
        };
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        console.log('[ChatActivityProbe] 🛑 Disabled');
    }
}

















