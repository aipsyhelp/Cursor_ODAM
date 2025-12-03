import * as vscode from 'vscode';
import { MemoryFileUpdater } from './memoryFileUpdater';
import { OdamClient } from './odamClient';
import { ContextLogger } from './contextLogger';
import { MemoryStatusBar } from './memoryStatusBar';

export interface HookPromptPayload {
    prompt: string;
    conversation_id?: string;
    generation_id?: string;
    model?: string;
}

export interface HookResponsePayload {
    text: string;
    conversation_id?: string;
    generation_id?: string;
}

export interface HookThoughtPayload {
    text: string;
    duration_ms?: number;
    conversation_id?: string;
    generation_id?: string;
}

interface PendingInteraction {
    query: string;
    conversationId?: string;
    generationId?: string;
    model?: string;
    createdAt: number;
}

interface HookEventProcessorDeps {
    memoryFileUpdater: MemoryFileUpdater;
    odamClient: OdamClient;
    logger?: ContextLogger;
    workspaceProvider: () => vscode.WorkspaceFolder | undefined;
    statusBar?: MemoryStatusBar;
    userId?: string;
}

export class HookEventProcessor implements vscode.Disposable {
    private dependencies: HookEventProcessorDeps;
    private pendingByGeneration: Map<string, PendingInteraction> = new Map();
    private pendingByConversation: Map<string, PendingInteraction> = new Map();
    private debugChannel: vscode.OutputChannel;

    constructor(deps: HookEventProcessorDeps) {
        this.dependencies = deps;
        
        // ✅ FIX: Create workspace-specific output channel to prevent log mixing between projects
        const workspaceFolder = deps.workspaceProvider();
        const channelName = workspaceFolder 
            ? `ODAM Hook Events (${require('path').basename(workspaceFolder.uri.fsPath)})`
            : 'ODAM Hook Events';
        this.debugChannel = vscode.window.createOutputChannel(channelName);
        this.debugChannel.appendLine(`[${new Date().toISOString()}] HookEventProcessor initialized`);
    }

    async handleBeforePrompt(payload: HookPromptPayload): Promise<void> {
        // ✅ IMPORTANT: Log immediately to verify hook is being called
        this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] 🔵 handleBeforePrompt called`);
        console.log('[HookEventProcessor] handleBeforePrompt called', { 
            conversationId: payload.conversation_id, 
            generationId: payload.generation_id,
            promptLength: payload.prompt?.length || 0
        });

        const workspaceFolder = this.dependencies.workspaceProvider();
        if (!workspaceFolder) {
            const error = 'Workspace folder not available';
            this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] ❌ ${error}`);
            throw new Error(error);
        }

        const userQuery = (payload.prompt || '').trim();
        if (!userQuery) {
            this.log('before: skip empty prompt');
            this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] ⚠️ Skipping empty prompt`);
            return;
        }

        const interaction: PendingInteraction = {
            query: userQuery,
            conversationId: payload.conversation_id,
            generationId: payload.generation_id,
            model: payload.model,
            createdAt: Date.now()
        };

        if (interaction.generationId) {
            this.pendingByGeneration.set(interaction.generationId, interaction);
        }
        if (interaction.conversationId) {
            this.pendingByConversation.set(interaction.conversationId, interaction);
        }

        this.log('before: received', {
            conversationId: payload.conversation_id,
            generationId: payload.generation_id,
            length: userQuery.length
        });

        await this.dependencies.memoryFileUpdater.updateMemoryFile(userQuery, workspaceFolder);
        this.log('before: updateMemoryFile completed');
    }

    async handleAfterResponse(payload: HookResponsePayload): Promise<void> {
        // ✅ IMPORTANT: Log immediately to verify hook is being called
        this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] 🟢 handleAfterResponse called`);
        console.log('[HookEventProcessor] handleAfterResponse called', { 
            conversationId: payload.conversation_id, 
            generationId: payload.generation_id,
            textLength: payload.text?.length || 0
        });

        const workspaceFolder = this.dependencies.workspaceProvider();
        if (!workspaceFolder) {
            const error = 'Workspace folder not available';
            this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] ❌ ${error}`);
            throw new Error(error);
        }

        const interaction = this.lookupInteraction(payload);
        const assistantResponse = (payload.text || '').trim();

        if (!interaction || !interaction.query || !assistantResponse) {
            const missingInfo = {
                hasInteraction: !!interaction,
                hasQuery: !!interaction?.query,
                hasResponse: !!assistantResponse
            };
            this.log('after: missing interaction or response', missingInfo);
            this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] ⚠️ Missing data: ${JSON.stringify(missingInfo)}`);
            return;
        }

        this.log('after: received', {
            conversationId: payload.conversation_id,
            generationId: payload.generation_id,
            queryLength: interaction.query.length,
            responseLength: assistantResponse.length
        });

        try {
            this.log('after: calling updateMemoryAfterResponse', {
                query: interaction.query.substring(0, 50),
                response: assistantResponse.substring(0, 50),
                queryLength: interaction.query.length,
                responseLength: assistantResponse.length
            });
            
            // ✅ IMPORTANT: Log before calling to ensure we see this in output
            this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] About to call updateMemoryAfterResponse with query length=${interaction.query.length}, response length=${assistantResponse.length}`);
            
            await this.dependencies.memoryFileUpdater.updateMemoryAfterResponse(
                interaction.query,
                assistantResponse,
                [],
                workspaceFolder
            );
            
            this.log('after: updateMemoryAfterResponse completed');
            this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] updateMemoryAfterResponse completed successfully`);
            
            // ✅ FIX: Update status bar tooltip with project-specific statistics after saving
            if (this.dependencies.statusBar && this.dependencies.userId && this.dependencies.odamClient) {
                try {
                    const workspaceFolder = this.dependencies.workspaceProvider();
                    if (workspaceFolder) {
                        const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);
                        // ✅ FIX: Get project-specific stats (with session_id) instead of global stats
                        const stats = await this.dependencies.odamClient.getMemoryStats(this.dependencies.userId, sessionId);
                        if (stats) {
                            this.dependencies.statusBar.updateTooltip(stats);
                            this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] Status bar tooltip updated with project stats: memories=${stats.total_memories}, entities=${stats.entities_count}, session_id=${sessionId}`);
                        }
                    }
                } catch (error) {
                    // Don't fail if tooltip update fails
                    console.warn('[HookEventProcessor] Failed to update tooltip:', error);
                }
            }
            
            // Verify that data was saved by checking ODAM directly
            // This will help us understand if the save actually happened
            this.log('after: verifying save - check ODAM API logs in output channels: "ODAM Memory File Updater" and "ODAM Client"');
            this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] Check output channels "ODAM Memory File Updater" and "ODAM Client" for detailed logs`);
        } catch (error: any) {
            const errorMsg = `after: ❌ ERROR saving to ODAM: ${error?.message || String(error)}`;
            this.log(errorMsg, {
                error: error?.message || String(error),
                stack: error?.stack?.substring(0, 200)
            });
            this.debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] ${errorMsg}`);
            this.debugChannel.appendLine(`[${new Date().toISOString()}] Stack: ${error?.stack?.substring(0, 500)}`);
            throw error;
        }
    }

    async handleAfterThought(payload: HookThoughtPayload): Promise<void> {
        if (!this.dependencies.logger) {
            this.log('thought: logger not available, skipping');
            return;
        }

        this.log('thought: received', {
            conversationId: payload.conversation_id,
            generationId: payload.generation_id,
            length: (payload.text || '').length,
            duration: payload.duration_ms
        });

        this.dependencies.logger.logCursorContext(
            payload.text || '',
            `THOUGHT (${payload.duration_ms ?? 0}ms)`,
            undefined,
            undefined,
            undefined
        );
    }

    clear(): void {
        this.pendingByGeneration.clear();
        this.pendingByConversation.clear();
        this.log('Cleared pending interactions');
    }

    dispose(): void {
        this.debugChannel.appendLine(`[${new Date().toISOString()}] HookEventProcessor disposed`);
        this.debugChannel.dispose();
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

    private lookupInteraction(payload: HookResponsePayload | HookThoughtPayload): PendingInteraction | undefined {
        const generationId = payload.generation_id;
        if (generationId && this.pendingByGeneration.has(generationId)) {
            const interaction = this.pendingByGeneration.get(generationId);
            if (interaction?.conversationId) {
                this.pendingByConversation.delete(interaction.conversationId);
            }
            if (interaction?.generationId) {
                this.pendingByGeneration.delete(interaction.generationId);
            }
            return interaction;
        }

        const conversationId = payload.conversation_id;
        if (conversationId && this.pendingByConversation.has(conversationId)) {
            const interaction = this.pendingByConversation.get(conversationId);
            if (interaction?.conversationId) {
                this.pendingByConversation.delete(interaction.conversationId);
            }
            if (interaction?.generationId) {
                this.pendingByGeneration.delete(interaction.generationId);
            }
            return interaction;
        }

        return undefined;
    }

    private log(message: string, data?: Record<string, unknown>): void {
        const entry = data ? `${message} ${JSON.stringify(data)}` : message;
        const line = `[HookEventProcessor] ${entry}`;
        console.log(line);
        this.debugChannel.appendLine(`[${new Date().toISOString()}] ${entry}`);
    }
}




