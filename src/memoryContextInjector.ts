/**
 * Memory Context Injector
 * Injects ODAM memory context into Cursor chat before messages are sent
 * Uses VS Code APIs to watch chat documents and refresh context proactively
 */

import * as vscode from 'vscode';
import { OdamClient } from './odamClient';
import { MemoryFileUpdater } from './memoryFileUpdater';

export class MemoryContextInjector {
    private client: OdamClient;
    private fileUpdater: MemoryFileUpdater;
    private userId: string;
    private lastContext: string = '';
    private contextCache: Map<string, { context: string; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 30000; // 30 seconds

    constructor(
        client: OdamClient,
        fileUpdater: MemoryFileUpdater,
        userId: string
    ) {
        this.client = client;
        this.fileUpdater = fileUpdater;
        this.userId = userId;
    }

    /**
     * Start the injector
     */
    start(context: vscode.ExtensionContext) {
        console.log('[Memory Context Injector] 🚀 Starting...');

        // Refresh context before chat opens
        this.setupPreChatUpdate(context);

        // Watch editor activity to detect chats
        this.setupEditorActivityWatcher(context);

        // Periodic context refresh
        this.setupPeriodicContextUpdate(context);

        console.log('[Memory Context Injector] ✅ Started successfully');
    }

    /**
     * Register pre-chat updates
     */
    private setupPreChatUpdate(context: vscode.ExtensionContext) {
        // Refresh when active editor changes
        const disposable = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (!editor) {
                return;
            }

            // Check if this looks like a chat document
            const document = editor.document;
            if (this.isChatDocument(document)) {
                await this.updateContextBeforeChat();
            }
        });

        context.subscriptions.push(disposable);
    }

    /**
     * Register editor activity watcher
     */
    private setupEditorActivityWatcher(context: vscode.ExtensionContext) {
        // Track document changes
        const disposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
            const document = event.document;
            
            if (this.isChatDocument(document)) {
                // Refresh when chat content changes
                await this.updateContextBeforeChat();
            }
        });

        context.subscriptions.push(disposable);
    }

    /**
     * Periodically update context (aggressive chat probing)
     */
    private setupPeriodicContextUpdate(context: vscode.ExtensionContext) {
        console.log('[Memory Context Injector] ⚙️ Setting up periodic context update (every 2 seconds)');
        const interval = setInterval(async () => {
            const activeEditor = vscode.window.activeTextEditor;
            const hasActiveEditor = !!activeEditor;
            const activeDoc = activeEditor?.document;
            const activeContent = activeDoc?.getText() || '';
            const hasUserPattern = activeContent.includes('User:') || activeContent.includes('You:') || activeContent.includes('Assistant:');
            
            console.log('[Memory Context Injector] ⏰ Periodic update triggered:', {
                hasActiveEditor,
                fileName: activeDoc?.fileName || '(none)',
                scheme: activeDoc?.uri.scheme || '(none)',
                contentLength: activeContent.length,
                hasUserPattern,
                isChat: activeDoc ? this.isChatDocument(activeDoc) : false
            });
            
            try {
                await this.updateContextBeforeChat();
            } catch (error) {
                console.error('[Memory Context Injector] ❌ Error in periodic update:', error);
            }
        }, 2000); // faster detection cadence

        context.subscriptions.push({
            dispose: () => {
                console.log('[Memory Context Injector] 🛑 Periodic update disposed');
                clearInterval(interval);
            }
        });

        // ✅ FIX: Also monitor active editor changes more aggressively
        const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (editor) {
                console.log('[Memory Context Injector] Active editor changed:', {
                    fileName: editor.document.fileName,
                    languageId: editor.document.languageId,
                    uri: editor.document.uri.toString(),
                    isChat: this.isChatDocument(editor.document)
                });
                await this.updateContextBeforeChat();
            }
        });

        context.subscriptions.push(activeEditorDisposable);

        // Monitor all text document changes (permissive)
        const textChangeDisposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
            const document = event.document;
            const content = document.getText();
            const hasUserPattern = content.includes('User:') || content.includes('You:') || content.includes('Assistant:');
            
            console.log('[Memory Context Injector] 📝 Text document changed:', {
                fileName: document.fileName,
                languageId: document.languageId,
                uri: document.uri.toString(),
                scheme: document.uri.scheme,
                contentLength: content.length,
                contentPreview: content.substring(0, 200),
                hasUserPattern,
                isChat: this.isChatDocument(document)
            });
            
            // Treat as chat if heuristics match
            if (this.isChatDocument(document) || 
                document.languageId === 'markdown' || 
                document.languageId === 'plaintext' ||
                (hasUserPattern && content.length < 100000)) {
                console.log('[Memory Context Injector] ✅ Processing document as potential chat');
                await this.updateContextBeforeChat();
            }
        });

        context.subscriptions.push(textChangeDisposable);
    }

    /**
     * Update context before interacting with chat
     * Always store extracted data in ODAM to build memory
     */
    private async updateContextBeforeChat(): Promise<void> {
        console.log('[Memory Context Injector] 🔄 updateContextBeforeChat() called');
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                console.log('[Memory Context Injector] ⚠️ No workspace folder');
                return;
            }

            // More aggressive extraction from the active editor
            const activeEditor = vscode.window.activeTextEditor;
            let userQuery = '';
            let assistantResponse = '';

            if (!activeEditor) {
                console.log('[Memory Context Injector] ⚠️ No active editor');
            } else {
                const document = activeEditor.document;
                const isChat = this.isChatDocument(document);
                const content = document.getText();
                const hasUserPattern = content.includes('User:') || content.includes('You:') || content.includes('Assistant:');
                
                console.log('[Memory Context Injector] 🔍 Checking active editor:', {
                    fileName: document.fileName,
                    languageId: document.languageId,
                    uri: document.uri.toString(),
                    scheme: document.uri.scheme,
                    isChat: isChat,
                    contentLength: content.length,
                    contentPreview: content.substring(0, 300),
                    hasUserPattern,
                    lastLines: content.split('\n').slice(-5).join(' | ')
                });

                // Try to extract even if document isn't flagged as chat
                if (content.length > 0 || hasUserPattern) {
                    userQuery = this.extractLastUserMessage(document);
                    assistantResponse = this.extractLastAssistantResponse(document);
                    
                    console.log('[Memory Context Injector] ✅ Extracted from document:', {
                        userQueryLength: userQuery.length,
                        userQueryPreview: userQuery.substring(0, 150),
                        assistantResponseLength: assistantResponse.length,
                        assistantResponsePreview: assistantResponse.substring(0, 100),
                        willUseQuery: userQuery.length > 10,
                        willSave: userQuery.length > 10 && assistantResponse.length > 10
                    });
                } else {
                    console.log('[Memory Context Injector] ⚠️ Document content is empty and no user patterns');
                }
            }

            // ✅ FIX: Save query + response together if both are available
            // Do NOT call updateMemory separately - use updateMemoryAfterResponse instead
            if (userQuery && userQuery.trim().length > 10 && assistantResponse && assistantResponse.trim().length > 10) {
                try {
                    await this.fileUpdater.updateMemoryAfterResponse(
                        userQuery,
                        assistantResponse,
                        [],  // Empty artifacts array
                        workspaceFolder
                    );
                    console.log('[Memory Context Injector] Saved query + response to ODAM');
                } catch (error) {
                    console.error('[Memory Context Injector] Error saving to ODAM:', error);
                }
            } else if (userQuery && userQuery.trim().length > 10) {
                // If only query is available, just update memory file (don't save separately)
                console.log('[Memory Context Injector] ✅ Updating memory file with query:', userQuery.substring(0, 50));
                await this.fileUpdater.updateMemoryFile(userQuery, workspaceFolder);
            } else {
                // Avoid overriding memory with empty query
                if (!userQuery || userQuery.trim().length === 0) {
                    console.log('[Memory Context Injector] ⚠️ No query extracted, skipping memory file update to avoid overwriting');
                    // Don't update with empty query - let other components handle it
                    return;
                }
            }

            // Update cache for quick follow-up access
            if (userQuery) {
                await this.updateContextCache(userQuery, workspaceFolder);
            }

        } catch (error) {
            console.error('[Memory Context Injector] Error updating context:', error);
        }
    }

    /**
     * Update the context cache
     */
    private async updateContextCache(query: string, workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        const cacheKey = `${this.userId}:${workspaceFolder.uri.fsPath}:${query.substring(0, 50)}`;
        const cached = this.contextCache.get(cacheKey);

        // Return cached context when still valid
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            this.lastContext = cached.context;
            return;
        }

        try {
            const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);
            const result = await this.client.fetchMemoryContext(query, this.userId, sessionId);

            if (result.context) {
                this.lastContext = result.context;
                this.contextCache.set(cacheKey, {
                    context: result.context,
                    timestamp: Date.now()
                });
            }
        } catch (error) {
            console.error('[Memory Context Injector] Error updating context cache:', error);
        }
    }

    /**
     * Determine whether the document represents a chat session
     */
    private isChatDocument(document: vscode.TextDocument): boolean {
        // Cursor stores chat transcripts in special URIs
        const uri = document.uri;
        const fileName = document.fileName.toLowerCase();

        return (
            uri.scheme === 'cursor-chat' ||
            fileName.includes('chat') ||
            fileName.includes('cursor') ||
            document.languageId === 'markdown' && document.getText().includes('User:') ||
            document.getText().includes('Assistant:')
        );
    }

    /**
     * Extract the last user message from the document
     */
    private extractLastUserMessage(document: vscode.TextDocument): string {
        const content = document.getText();
        
        const patterns = [
            // Pattern 1: "User: ..." before "Assistant:"
            /User:\s*(.+?)(?=Assistant:|$)/is,
            // Pattern 2: Last lines before "Assistant:" or "You:"
            /^(.+?)(?=\n\n(?:Assistant|AI|Cursor|You):)/m,
            // Pattern 3: "## User\n\n..."
            /## User\n\n(.+?)(?=\n##|$)/is,
            // Pattern 4: Markdown heading
            /^###?\s*User\s*$\n\n(.+?)(?=\n###?|$)/ims,
            // Pattern 5: Last block before "Assistant"
            /(.+?)(?=\n\n(?:Assistant|AI|Cursor):)/s,
            // Pattern 7: Last meaningful line (fallback) - more permissive
            /(?:^|\n)([^\n@#]+?)$/m,
            // Pattern 8: Any text that's not Assistant response (very permissive)
            /(.+?)(?=\n\n(?:Assistant|AI|Cursor|You):|$)/s
        ];
        
        for (const pattern of patterns) {
            try {
                const match = content.match(pattern);
                if (match && match[1]) {
                    let msg = match[1].trim();
                    
                    // Clean up
                    msg = msg.replace(/^User:\s*/i, '');
                    msg = msg.replace(/^@user[:\s]*/i, '');
                    
                    // Filter out code blocks, markdown headers, and very short messages
                    if (msg.length > 5 && 
                        !msg.match(/^#{1,6}\s/) && 
                        !msg.match(/^---/) && 
                        !msg.match(/^```/) &&
                        !msg.match(/^(Assistant|AI|Cursor):/i) &&
                        msg.split('\n').length < 50) {
                        console.log('[Memory Context Injector] ✅ Extracted user message:', {
                            length: msg.length,
                            preview: msg.substring(0, 100),
                            pattern: pattern.toString().substring(0, 50)
                        });
                        return msg;
                    }
                }
            } catch (e) {
                continue;
            }
        }

        // ✅ FIX: Fallback - get last meaningful line
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        if (lines.length > 0) {
            const lastLine = lines[lines.length - 1].trim();
            if (lastLine.length > 5 && 
                !lastLine.startsWith('#') && 
                !lastLine.startsWith('---') &&
                !lastLine.startsWith('```') &&
                !lastLine.match(/^(Assistant|AI|Cursor):/i)) {
                console.log('[Memory Context Injector] ✅ Using last line as fallback:', lastLine.substring(0, 100));
                return lastLine;
            }
        }

        return '';
    }

    /**
     * Extract the last assistant response
     */
    private extractLastAssistantResponse(document: vscode.TextDocument): string {
        const content = document.getText();
        
        // Search for the last assistant block
        // Format 1: "Assistant: ..."
        const assistantMatch = content.match(/Assistant:\s*(.+?)(?=User:|$)/is);
        if (assistantMatch) {
            return assistantMatch[1].trim();
        }

        // Format 2: "## Assistant\n\n..."
        const altMatch = content.match(/## Assistant\n\n(.+?)(?=\n##|$)/is);
        if (altMatch) {
            return altMatch[1].trim();
        }

        // Format 3: Markdown heading
        const markdownMatch = content.match(/^###?\s*Assistant\s*$\n\n(.+?)(?=\n###?|$)/ims);
        if (markdownMatch) {
            return markdownMatch[1].trim();
        }

        return '';
    }

    /**
     * Derive session_id for the workspace path
     */
    private getSessionId(workspacePath: string): string {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(workspacePath);
        return hash.digest('hex').substring(0, 16);
    }

    /**
     * Return the last known context
     */
    getLastContext(): string {
        return this.lastContext;
    }

    /**
     * Stop the injector
     */
    dispose() {
        this.contextCache.clear();
    }
}


