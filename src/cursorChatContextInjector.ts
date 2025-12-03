/**
 * Cursor Chat Context Injector
 * Automatically injects ODAM context into Cursor chat and keeps `.cursor/rules/odam-memory.mdc` updated
 */

import * as vscode from 'vscode';
import { OdamClient, CodeArtifact } from './odamClient';
import { MemoryFileUpdater } from './memoryFileUpdater';
import { CodeArtifactTracker } from './codeArtifactTracker';

export class CursorChatContextInjector {
    private client: OdamClient;
    private fileUpdater: MemoryFileUpdater;
    private artifactTracker: CodeArtifactTracker | null;
    private userId: string;
    private lastQuery: string = '';
    private updateDebounceTimer: NodeJS.Timeout | null = null;
    private isUpdating: boolean = false;
    private outputChannel: vscode.OutputChannel;

    constructor(
        client: OdamClient,
        fileUpdater: MemoryFileUpdater,
        userId: string,
        artifactTracker?: CodeArtifactTracker | null
    ) {
        this.client = client;
        this.fileUpdater = fileUpdater;
        this.userId = userId;
        this.artifactTracker = artifactTracker || null;
        this.outputChannel = vscode.window.createOutputChannel('ODAM Chat Context Injector');
    }

    /**
     * Start the context injector
     */
    start(context: vscode.ExtensionContext) {
        const logMsg = '[Cursor Chat Context Injector] Starting...';
        console.log(logMsg);
        this.outputChannel.appendLine(logMsg);
        this.outputChannel.show(true); // auto-show channel

        // Monitor chat updates through the memory file
        this.setupMemoryFileWatcher(context);

        // Proactively refresh context before sending
        this.setupActiveContextUpdate(context);

        // Track code changes to update context
        this.setupCodeChangeWatcher(context);

        const successMsg = '[Cursor Chat Context Injector] Started successfully';
        console.log(successMsg);
        this.outputChannel.appendLine(successMsg);
    }

    /**
     * Register memory file watcher
     */
    private setupMemoryFileWatcher(context: vscode.ExtensionContext) {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        // Monitor memory file updates
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(workspaceFolder, '.cursor/rules/odam-memory.mdc')
        );

        watcher.onDidChange(async (uri) => {
            console.log('[Cursor Chat Context Injector] Memory file updated:', uri.fsPath);
        });

        context.subscriptions.push(watcher);
    }

    /**
     * Track chat edits and refresh context before user sends a message
     */
    private setupActiveContextUpdate(context: vscode.ExtensionContext) {
        // ✅ FIX: Track text changes in chat documents to update context BEFORE send
        const textChangeDisposable = vscode.workspace.onDidChangeTextDocument(async (event) => {
            const document = event.document;
            
            // ✅ FIX: Enhanced logging to debug chat detection - LOG ALL DOCUMENTS
            const content = document.getText();
            const contentPreview = content.substring(0, 200);
            const hasUserPattern = content.includes('User:') || content.includes('You:') || content.includes('Assistant:');
            
            const logData = {
                fileName: document.fileName,
                uri: document.uri.toString(),
                scheme: document.uri.scheme,
                languageId: document.languageId,
                lineCount: document.lineCount,
                contentLength: content.length,
                contentPreview: contentPreview,
                hasUserPattern: hasUserPattern,
                isChat: this.isChatDocument(document)
            };
            console.log('[Cursor Chat Context Injector] 📝 Text document changed:', logData);
            this.outputChannel.appendLine(`[${new Date().toISOString()}] 📝 Text document changed:`);
            this.outputChannel.appendLine(`  File: ${logData.fileName}`);
            this.outputChannel.appendLine(`  URI: ${logData.uri}`);
            this.outputChannel.appendLine(`  Scheme: ${logData.scheme}`);
            this.outputChannel.appendLine(`  Language: ${logData.languageId}`);
            this.outputChannel.appendLine(`  Length: ${logData.contentLength}`);
            this.outputChannel.appendLine(`  Is Chat: ${logData.isChat}`);
            this.outputChannel.appendLine(`  Preview: ${logData.contentPreview}`);
            
            // ✅ FIX: Try to process ALL documents, not just detected chat documents
            // Cursor chat might not be detected properly, so we'll try to extract from any document
            const isChat = this.isChatDocument(document);
            
            // If not detected as chat but has user patterns, treat as chat
            if (!isChat && hasUserPattern && content.length < 100000) {
                console.log('[Cursor Chat Context Injector] ⚠️ Document not detected as chat but has user patterns - treating as chat');
            }
            
            // Check if this is a chat document OR has user patterns
            if (!isChat && !hasUserPattern) {
                return;
            }
            
            // ✅ FIX: Log content preview for debugging (content already extracted above)
            console.log('[Cursor Chat Context Injector] Chat document content preview:', {
                length: content.length,
                first100: content.substring(0, 100),
                last100: content.substring(Math.max(0, content.length - 100))
            });
            
            // ✅ FIX: Extract user's current message (what they're typing)
            const userMessage = this.extractCurrentUserMessage(content);
            
            console.log('[Cursor Chat Context Injector] Extracted message:', {
                found: !!userMessage,
                length: userMessage?.length || 0,
                preview: userMessage?.substring(0, 100) || '(empty)',
                isDifferent: userMessage !== this.lastQuery
            });
            
            if (userMessage && userMessage.length > 10 && userMessage !== this.lastQuery) {
                this.lastQuery = userMessage;
                
                const logData = {
                    length: userMessage.length,
                    preview: userMessage.substring(0, 100)
                };
                console.log('[Cursor Chat Context Injector] ✅ Detected user typing:', logData);
                this.outputChannel.appendLine(`[${new Date().toISOString()}] ✅ Detected user typing:`);
                this.outputChannel.appendLine(`  Length: ${logData.length}`);
                this.outputChannel.appendLine(`  Preview: ${logData.preview}`);
                
                // ✅ FIX: Update memory file WITH user's query BEFORE they send it
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    // Debounce: wait 500ms after user stops typing
                    if (this.updateDebounceTimer) {
                        clearTimeout(this.updateDebounceTimer);
                    }
                    
                    this.updateDebounceTimer = setTimeout(async () => {
                        const debounceMsg = `[Cursor Chat Context Injector] ⏰ Debounce timeout - updating context with query: ${userMessage.substring(0, 50)}`;
                        console.log(debounceMsg);
                        this.outputChannel.appendLine(`[${new Date().toISOString()}] ⏰ ${debounceMsg}`);
                        await this.updateContextForChat(workspaceFolder, userMessage);
                        const successMsg = '[Cursor Chat Context Injector] ✅ Context updated with user query BEFORE send';
                        console.log(successMsg);
                        this.outputChannel.appendLine(`[${new Date().toISOString()}] ✅ ${successMsg}`);
                    }, 500);
                }
            } else {
                if (!userMessage || userMessage.length <= 10) {
                    const warnData = {
                        length: userMessage?.length || 0,
                        preview: userMessage?.substring(0, 50) || '(empty)'
                    };
                    console.warn('[Cursor Chat Context Injector] ⚠️ Message too short or empty:', warnData);
                    this.outputChannel.appendLine(`[${new Date().toISOString()}] ⚠️ Message too short or empty: ${warnData.length} chars`);
                }
            }
        });

        context.subscriptions.push(textChangeDisposable);

        // Fallback: periodic refresh for general context
        const updateInterval = setInterval(async () => {
            if (this.isUpdating) {
                return;
            }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            // Refresh context using the last query (or empty fallback)
            await this.updateContextForChat(workspaceFolder, this.lastQuery || '');
        }, 10000); // gentler fallback cadence

        context.subscriptions.push({
            dispose: () => {
                clearInterval(updateInterval);
                if (this.updateDebounceTimer) {
                    clearTimeout(this.updateDebounceTimer);
                }
            }
        });
    }

    /**
     * ✅ FIX: Extract current user message from chat content (what user is typing)
     * Improved patterns for Cursor chat format
     */
    private extractCurrentUserMessage(content: string): string {
        // ✅ FIX: More aggressive patterns for Cursor chat
        const patterns = [
            // Pattern 1: Last non-empty line that's not Assistant response
            /(?:^|\n)([^\n]+?)(?=\n\n(?:Assistant|AI|Cursor|You):|$)/m,
            // Pattern 2: User: ... pattern
            /User:\s*(.+?)(?=\n\n(?:Assistant|AI|Cursor):|$)/is,
            // Pattern 3: @user pattern
            /@user[:\s]*(.+?)(?=@assistant|$)/is,
            // Pattern 4: Lines at the end (user typing) - more permissive
            /(?:^|\n)([^\n@#]+?)$/m,
            // Pattern 5: Any text that's not in code blocks and not Assistant response
            /(?:^|\n)((?:[^`\n]|`[^`]*`)+?)(?=\n\n(?:Assistant|AI|Cursor):|$)/m
        ];
        
        // Try each pattern
        for (const pattern of patterns) {
            try {
                const matches = content.match(pattern);
                if (matches && matches[1]) {
                    let msg = matches[1].trim();
                    
                    // Clean up the message
                    msg = msg.replace(/^User:\s*/i, ''); // Remove "User:" prefix
                    msg = msg.replace(/^@user[:\s]*/i, ''); // Remove "@user" prefix
                    
                    // Filter out code blocks, markdown headers, and very short messages
                    if (msg.length > 5 && 
                        !msg.match(/^#{1,6}\s/) && // Not a markdown header
                        !msg.match(/^---/) && // Not a separator
                        !msg.match(/^```/) && // Not a code block start
                        msg.split('\n').length < 50) { // Not too long (likely code)
                        console.log('[Cursor Chat Context Injector] Extracted message:', {
                            length: msg.length,
                            preview: msg.substring(0, 100),
                            pattern: pattern.toString().substring(0, 50)
                        });
                        return msg;
                    }
                }
            } catch (e) {
                // Skip invalid patterns
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
                console.log('[Cursor Chat Context Injector] Using last line as fallback:', lastLine.substring(0, 100));
                return lastLine;
            }
        }
        
        return '';
    }

    /**
     * ✅ FIX: Check if document is a chat document
     * Based on Cursor documentation: Cursor uses .cursor/rules/*.mdc files
     * Chat might be in a different format - we need to detect it properly
     */
    private isChatDocument(document: vscode.TextDocument): boolean {
        const fileName = document.fileName.toLowerCase();
        const uri = document.uri.toString().toLowerCase();
        const scheme = document.uri.scheme.toLowerCase();
        
        // ✅ FIX: More permissive detection - log for debugging
        const checks = {
            fileName: fileName.includes('chat') || fileName.includes('cursor'),
            uri: uri.includes('cursor-chat') || uri.includes('chat'),
            scheme: scheme === 'cursor-chat' || scheme === 'vscode-chat' || scheme === 'vscode-notebook',
            languageId: document.languageId === 'markdown' || document.languageId === 'plaintext'
        };
        
        // Log for debugging
        if (checks.fileName || checks.uri || checks.scheme) {
            console.log('[Cursor Chat Context Injector] Chat document detected:', checks);
        }
        
        // Check file name patterns
        if (checks.fileName) {
            return true;
        }
        
        // Check URI scheme (Cursor may use custom schemes)
        if (checks.uri || checks.scheme) {
            return true;
        }
        
        // ✅ FIX: More permissive - check content patterns for any document
        // Cursor chat might not have specific file name/scheme
        const content = document.getText();
        const hasChatPatterns = content.includes('User:') || 
                                content.includes('Assistant:') ||
                                content.includes('@user') ||
                                content.includes('@assistant') ||
                                content.includes('You:') ||
                                content.includes('AI:');
        
        // If it's a small document with chat patterns, treat it as chat
        if (checks.languageId && content.length < 50000 && hasChatPatterns) {
            console.log('[Cursor Chat Context Injector] Chat detected by content patterns:', {
                length: content.length,
                hasPatterns: hasChatPatterns
            });
            return true;
        }
        
        return false;
    }

    /**
     * Track code changes
     */
    private setupCodeChangeWatcher(context: vscode.ExtensionContext) {
        // Watch file saves to refresh context
        const saveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
            // Debounce to avoid excessive updates
            if (this.updateDebounceTimer) {
                clearTimeout(this.updateDebounceTimer);
            }

            this.updateDebounceTimer = setTimeout(async () => {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    // Refresh context after saving the file
                    await this.updateContextAfterCodeChange(workspaceFolder, document);
                }
            }, 2000); // 2 second debounce
        });

        context.subscriptions.push(saveDisposable);
    }

    /**
     * Update context for chat
     */
    async updateContextForChat(
        workspaceFolder: vscode.WorkspaceFolder,
        userQuery: string = ''
    ): Promise<void> {
        if (this.isUpdating) {
            return;
        }

        this.isUpdating = true;
        try {
            console.log('[Cursor Chat Context Injector] Updating context for chat:', {
                query: userQuery.substring(0, 50),
                workspace: workspaceFolder.name
            });

            // Write the latest context to the memory file
            await this.fileUpdater.updateMemoryFile(userQuery, workspaceFolder);

            console.log('[Cursor Chat Context Injector] Context updated successfully');
        } catch (error) {
            console.error('[Cursor Chat Context Injector] Error updating context:', error);
        } finally {
            this.isUpdating = false;
        }
    }

    /**
     * Update context after code change
     */
    private async updateContextAfterCodeChange(
        workspaceFolder: vscode.WorkspaceFolder,
        document: vscode.TextDocument
    ): Promise<void> {
        try {
            // Build context based on the modified file
            const filePath = document.fileName;
            const query = `File updated ${filePath}`;

            console.log('[Cursor Chat Context Injector] Updating context after code change:', filePath);

            // Refresh context
            await this.updateContextForChat(workspaceFolder, query);

            // Persist artifacts if tracker available
            if (this.artifactTracker) {
                await this.artifactTracker.trackDocumentSave(document, workspaceFolder);
            }
        } catch (error) {
            console.error('[Cursor Chat Context Injector] Error updating context after code change:', error);
        }
    }

    /**
     * Update context before sending a chat message
     * Called before the user message is sent
     */
    async updateContextBeforeMessage(userQuery: string): Promise<void> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return;
        }

        this.lastQuery = userQuery;

        console.log('[Cursor Chat Context Injector] Updating context before message:', {
            query: userQuery.substring(0, 50)
        });

        // Refresh context using the specific user query
        await this.updateContextForChat(workspaceFolder, userQuery);
    }

    /**
     * Update memory after receiving a response
     */
    async updateMemoryAfterResponse(
        userQuery: string,
        assistantResponse: string
    ): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return;
            }

            const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);

            console.log('[Cursor Chat Context Injector] Updating memory after response:', {
                queryLength: userQuery.length,
                responseLength: assistantResponse.length
            });

            // Save data to ODAM memory
            // ✅ FIX: Save query + response together via updateMemoryAfterResponse
            // Do NOT call updateMemory separately - it's handled in updateMemoryAfterResponse
            // Extract artifacts from response if tracker is available
            const artifacts = this.artifactTracker && workspaceFolder
                ? this.fileUpdater.extractArtifactsFromResponse(assistantResponse, workspaceFolder)
                : [];
            
            await this.fileUpdater.updateMemoryAfterResponse(
                userQuery,
                assistantResponse,
                artifacts,  // ✅ Pass artifacts if available
                workspaceFolder
            );

            console.log('[Cursor Chat Context Injector] Memory updated after response');
        } catch (error) {
            console.error('[Cursor Chat Context Injector] Error updating memory after response:', error);
        }
    }

    /**
     * Derive session_id for the workspace
     */
    private getSessionId(workspacePath: string): string {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(workspacePath);
        return hash.digest('hex').substring(0, 16);
    }

    /**
     * Dispose context injector
     */
    dispose() {
        if (this.updateDebounceTimer) {
            clearTimeout(this.updateDebounceTimer);
            this.updateDebounceTimer = null;
        }
        this.outputChannel.dispose();
    }
}


