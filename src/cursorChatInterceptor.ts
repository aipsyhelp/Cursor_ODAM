/**
 * Cursor Chat Interceptor
 * Automatically detects chat messages and keeps ODAM memory in sync
 */

import * as vscode from 'vscode';
import { MemoryFileUpdater } from './memoryFileUpdater';
import { OdamClient } from './odamClient';

export class CursorChatInterceptor {
    private fileUpdater: MemoryFileUpdater;
    private client: OdamClient;
    private userId: string;
    private lastUserMessage: string = '';
    private lastAssistantResponse: string = '';
    private updateTimer: NodeJS.Timeout | null = null;
    private isUpdating: boolean = false;
    private outputChannel: vscode.OutputChannel;

    constructor(
        fileUpdater: MemoryFileUpdater,
        client: OdamClient,
        userId: string
    ) {
        this.fileUpdater = fileUpdater;
        this.client = client;
        this.userId = userId;
        this.outputChannel = vscode.window.createOutputChannel('ODAM Chat Interceptor');
    }

    /**
     * Start the interceptor
     */
    start(context: vscode.ExtensionContext) {
        const logMsg = '[Cursor Chat Interceptor] Starting...';
        console.log(logMsg);
        this.outputChannel.appendLine(logMsg);
        this.outputChannel.show(true); // show channel automatically

        // Monitor memory file for changes
        this.setupMemoryFileWatcher(context);

        // Periodic memory update
        this.setupPeriodicUpdate(context);

        // Monitor active editor for new chat messages
        this.setupEditorWatcher(context);

        const successMsg = '[Cursor Chat Interceptor] Started successfully';
        console.log(successMsg);
        this.outputChannel.appendLine(successMsg);
    }

    /**
     * Watch the ODAM memory file for changes
     */
    private setupMemoryFileWatcher(context: vscode.ExtensionContext) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        const memoryFilePath = vscode.Uri.joinPath(
            workspaceFolder.uri,
            '.cursor',
            'rules',
            'odam-memory.mdc'
        );

        // Ensure file exists
        const fs = require('fs');
        const path = require('path');
        const filePath = memoryFilePath.fsPath;
        const dirPath = path.dirname(filePath);

        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, '', 'utf8');
        }

        // Watch file changes
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '.cursor/rules/odam-memory.mdc')
        );

        watcher.onDidChange(async (uri) => {
            console.log('[Cursor Chat Interceptor] Memory file changed:', uri.fsPath);
            // Memory file updated – reserved for future hooks
        });

        watcher.onDidCreate(async (uri) => {
            console.log('[Cursor Chat Interceptor] Memory file created:', uri.fsPath);
        });

        watcher.onDidDelete(async (uri) => {
            console.log('[Cursor Chat Interceptor] Memory file deleted:', uri.fsPath);
        });

        context.subscriptions.push(watcher);
    }

    /**
     * Schedule periodic updates
     */
    private setupPeriodicUpdate(context: vscode.ExtensionContext) {
        // Refresh memory every 30 seconds if we have pending changes
        this.updateTimer = setInterval(async () => {
            if (this.isUpdating) {
                return;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            // Require an active editor with chat content
            const activeEditor = vscode.window.activeTextEditor;
            if (!activeEditor) {
                return;
            }

            // Update memory with the latest user query
            if (this.lastUserMessage) {
                await this.updateMemoryWithQuery(this.lastUserMessage, workspaceFolder);
            }
        }, 30000); // 30 seconds

        context.subscriptions.push({
            dispose: () => {
                if (this.updateTimer) {
                    clearInterval(this.updateTimer);
                }
            }
        });
    }

    /**
     * Register editor watcher
     */
    private setupEditorWatcher(context: vscode.ExtensionContext) {
        // Track active editor changes
        const disposable = vscode.window.onDidChangeActiveTextEditor(async (editor) => {
            if (!editor) {
                return;
            }

            // Detect Cursor chat documents
            const document = editor.document;
            if (document.fileName.includes('chat') || document.fileName.includes('cursor')) {
                await this.processChatDocument(document);
            }
        });

        context.subscriptions.push(disposable);

        // Track text document changes as well
        const changeDisposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
            const document = event.document;
            
            // Detect chat-labeled files
            if (document.fileName.includes('chat') || document.fileName.includes('cursor')) {
                await this.processChatDocument(document);
            }
        });

        context.subscriptions.push(changeDisposable);
    }

    /**
     * Process chat document content and extract messages
     */
    private async processChatDocument(document: vscode.TextDocument) {
        try {
            const content = document.getText();
            
            // ✅ FIX: Multiple patterns for user messages (Cursor may use different formats)
            const userPatterns = [
                /User:\s*(.+?)(?=Assistant:|$)/is,  // User: ... Assistant:
                /^(.+?)(?=\n\nAssistant:|\n\nYou:)/m,  // Plain text before Assistant:
                /@user[:\s]*(.+?)(?=@assistant|$)/is,  // @user ... @assistant
                /(?:^|\n)([^@\n]+?)(?=\n\n(?:Assistant|AI|Cursor):)/m  // Lines before Assistant/AI/Cursor
            ];
            
            let userMessage = '';
            for (const pattern of userPatterns) {
                const match = content.match(pattern);
                if (match && match[1]) {
                    const msg = match[1].trim();
                    if (msg.length > 10 && !msg.includes('```') && !msg.startsWith('#')) {
                        userMessage = msg;
                        break;
                    }
                }
            }
            
            if (userMessage && userMessage !== this.lastUserMessage) {
                this.lastUserMessage = userMessage;
                const logData = {
                    length: userMessage.length,
                    preview: userMessage.substring(0, 100),
                    document: document.fileName
                };
                console.log('[Cursor Chat Interceptor] Detected user message:', logData);
                this.outputChannel.appendLine(`[${new Date().toISOString()}] ✅ Detected user message:`);
                this.outputChannel.appendLine(`  Length: ${logData.length}`);
                this.outputChannel.appendLine(`  Preview: ${logData.preview}`);
                this.outputChannel.appendLine(`  Document: ${logData.document}`);
                
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    await this.updateMemoryWithQuery(userMessage, workspaceFolder);
                }
            }

            // ✅ FIX: Multiple patterns for assistant responses
            const assistantPatterns = [
                /Assistant:\s*(.+?)(?=User:|$)/is,  // Assistant: ... User:
                /(?:Assistant|AI|Cursor):\s*(.+?)(?=\n\nUser:|$)/is,  // Assistant/AI/Cursor: ...
                /@assistant[:\s]*(.+?)(?=@user|$)/is,  // @assistant ... @user
                /(?:^|\n)(?:Assistant|AI|Cursor)[:\s]*(.+?)(?=\n\n(?:User|You):|$)/m  // Lines after Assistant:
            ];
            
            let assistantResponse = '';
            for (const pattern of assistantPatterns) {
                const match = content.match(pattern);
                if (match && match[1]) {
                    const msg = match[1].trim();
                    if (msg.length > 10) {
                        assistantResponse = msg;
                        break;
                    }
                }
            }
            
            if (assistantResponse && assistantResponse !== this.lastAssistantResponse) {
                this.lastAssistantResponse = assistantResponse;
                const logData = {
                    length: assistantResponse.length,
                    preview: assistantResponse.substring(0, 100),
                    hasUserMessage: !!this.lastUserMessage
                };
                console.log('[Cursor Chat Interceptor] Detected assistant response:', logData);
                this.outputChannel.appendLine(`[${new Date().toISOString()}] ✅ Detected assistant response:`);
                this.outputChannel.appendLine(`  Length: ${logData.length}`);
                this.outputChannel.appendLine(`  Preview: ${logData.preview}`);
                this.outputChannel.appendLine(`  Has user message: ${logData.hasUserMessage}`);
                
                // ✅ FIX: Only update memory if we have both query and response
                if (this.lastUserMessage && this.lastUserMessage.length > 10) {
                    await this.updateMemoryAfterResponse(this.lastUserMessage, assistantResponse);
                } else {
                    const warnMsg = '[Cursor Chat Interceptor] No user message found, skipping memory update';
                    console.warn(warnMsg);
                    this.outputChannel.appendLine(`⚠️ ${warnMsg}`);
                }
            }
        } catch (error) {
            console.error('[Cursor Chat Interceptor] Error processing chat document:', error);
        }
    }

    /**
     * Update memory file using the latest user query
     */
    private async updateMemoryWithQuery(
        query: string,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<void> {
        if (this.isUpdating) {
            return;
        }

        this.isUpdating = true;
        try {
            console.log('[Cursor Chat Interceptor] Updating memory with query:', query.substring(0, 50));
            
            await this.fileUpdater.updateMemoryFile(query, workspaceFolder);
            
            console.log('[Cursor Chat Interceptor] Memory updated successfully');
        } catch (error) {
            console.error('[Cursor Chat Interceptor] Error updating memory:', error);
        } finally {
            this.isUpdating = false;
        }
    }

    /**
     * Update memory after the assistant responds
     */
    private async updateMemoryAfterResponse(
        userQuery: string,
        assistantResponse: string
    ): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);

            console.log('[Cursor Chat Interceptor] Updating memory after response:', {
                queryLength: userQuery.length,
                responseLength: assistantResponse.length
            });

            // Save to ODAM first, then refresh the memory file for Cursor
            console.log('[Cursor Chat Interceptor] Saving to ODAM memory:', {
                queryLength: userQuery.length,
                responseLength: assistantResponse.length
            });

            // ✅ FIX: Save query + response together via updateMemoryAfterResponse
            // Do NOT call updateMemory separately - it's handled in updateMemoryAfterResponse
            await this.fileUpdater.updateMemoryAfterResponse(
                userQuery,
                assistantResponse,
                [],  // ✅ Pass empty artifacts array
                workspaceFolder
            );

            // Refresh the .mdc file to reflect ODAM data
            await this.fileUpdater.updateMemoryFile(userQuery, workspaceFolder);

            console.log('[Cursor Chat Interceptor] Memory updated after response');
        } catch (error) {
            console.error('[Cursor Chat Interceptor] Error updating memory after response:', error);
        }
    }

    /**
     * Derive session_id for workspace path
     */
    private getSessionId(workspacePath: string): string {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(workspacePath);
        return hash.digest('hex').substring(0, 16);
    }

    /**
     * Dispose interceptor resources
     */
    dispose() {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
        this.outputChannel.dispose();
    }
}




