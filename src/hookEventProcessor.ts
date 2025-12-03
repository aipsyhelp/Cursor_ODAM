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
    private debugChannels: Map<string, vscode.OutputChannel> = new Map();

    constructor(deps: HookEventProcessorDeps) {
        this.dependencies = deps;
        
        // ✅ FIX: Output channels will be created dynamically based on current workspace during event processing
        // This ensures logs appear in the correct project's output channel
        const workspaceFolder = deps.workspaceProvider();
        if (workspaceFolder) {
            const channel = this.getOutputChannel(workspaceFolder);
            channel.appendLine(`[${new Date().toISOString()}] HookEventProcessor initialized for workspace: ${workspaceFolder.name}`);
        }
    }

    /**
     * Get or create workspace-specific output channel
     * This ensures logs appear in the correct project's output channel
     */
    private getOutputChannel(workspaceFolder: vscode.WorkspaceFolder): vscode.OutputChannel {
        const path = require('path');
        const workspaceName = path.basename(workspaceFolder.uri.fsPath);
        const channelName = `ODAM Hook Events (${workspaceName})`;
        
        // VS Code will return existing channel if it exists, or create new one
        // This ensures we always use the correct channel for the current workspace
        if (!this.debugChannels.has(channelName)) {
            const channel = vscode.window.createOutputChannel(channelName);
            this.debugChannels.set(channelName, channel);
        }
        
        return this.debugChannels.get(channelName)!;
    }

    async handleBeforePrompt(payload: HookPromptPayload): Promise<void> {
        const workspaceFolder = this.dependencies.workspaceProvider();
        if (!workspaceFolder) {
            const error = 'Workspace folder not available';
            console.error(`[HookEventProcessor] ❌ ${error}`);
            throw new Error(error);
        }

        // ✅ FIX: Get output channel for current workspace to ensure logs appear in correct project
        const debugChannel = this.getOutputChannel(workspaceFolder);
        
        // ✅ IMPORTANT: Log immediately to verify hook is being called
        debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] 🔵 handleBeforePrompt called for workspace: ${workspaceFolder.name}`);
        console.log('[HookEventProcessor] handleBeforePrompt called', { 
            conversationId: payload.conversation_id, 
            generationId: payload.generation_id,
            promptLength: payload.prompt?.length || 0,
            workspaceName: workspaceFolder.name
        });

        const userQuery = (payload.prompt || '').trim();
        if (!userQuery) {
            this.log('before: skip empty prompt', undefined, workspaceFolder);
            debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] ⚠️ Skipping empty prompt`);
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
        }, workspaceFolder);

        await this.dependencies.memoryFileUpdater.updateMemoryFile(userQuery, workspaceFolder);
        this.log('before: updateMemoryFile completed', undefined, workspaceFolder);
    }

    async handleAfterResponse(payload: HookResponsePayload): Promise<void> {
        const workspaceFolder = this.dependencies.workspaceProvider();
        if (!workspaceFolder) {
            const error = 'Workspace folder not available';
            console.error(`[HookEventProcessor] ❌ ${error}`);
            throw new Error(error);
        }

        // ✅ FIX: Get output channel for current workspace to ensure logs appear in correct project
        const debugChannel = this.getOutputChannel(workspaceFolder);
        
        // ✅ IMPORTANT: Log immediately to verify hook is being called
        debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] 🟢 handleAfterResponse called for workspace: ${workspaceFolder.name}`);
        console.log('[HookEventProcessor] handleAfterResponse called', { 
            conversationId: payload.conversation_id, 
            generationId: payload.generation_id,
            textLength: payload.text?.length || 0,
            workspaceName: workspaceFolder.name
        });

        const interaction = this.lookupInteraction(payload);
        const assistantResponse = (payload.text || '').trim();

        if (!interaction || !interaction.query || !assistantResponse) {
            const missingInfo = {
                hasInteraction: !!interaction,
                hasQuery: !!interaction?.query,
                hasResponse: !!assistantResponse
            };
            this.log('after: missing interaction or response', missingInfo, workspaceFolder);
            debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] ⚠️ Missing data: ${JSON.stringify(missingInfo)}`);
            return;
        }

        this.log('after: received', {
            conversationId: payload.conversation_id,
            generationId: payload.generation_id,
            queryLength: interaction.query.length,
            responseLength: assistantResponse.length
        }, workspaceFolder);

        try {
            this.log('after: calling updateMemoryAfterResponse', {
                query: interaction.query.substring(0, 50),
                response: assistantResponse.substring(0, 50),
                queryLength: interaction.query.length,
                responseLength: assistantResponse.length
            }, workspaceFolder);
            
            // ✅ IMPORTANT: Log before calling to ensure we see this in output
            debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] About to call updateMemoryAfterResponse with query length=${interaction.query.length}, response length=${assistantResponse.length}`);
            
            await this.dependencies.memoryFileUpdater.updateMemoryAfterResponse(
                interaction.query,
                assistantResponse,
                [],
                workspaceFolder
            );
            
            this.log('after: updateMemoryAfterResponse completed', undefined, workspaceFolder);
            debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] updateMemoryAfterResponse completed successfully`);
            
            // ✅ FIX: Update status bar tooltip with project-specific statistics after saving
            if (this.dependencies.statusBar && this.dependencies.userId && this.dependencies.odamClient) {
                try {
                    const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);
                    // ✅ FIX: Get project-specific stats (with session_id) instead of global stats
                    const stats = await this.dependencies.odamClient.getMemoryStats(this.dependencies.userId, sessionId);
                    if (stats) {
                        this.dependencies.statusBar.updateTooltip(stats);
                        debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] Status bar tooltip updated with project stats: memories=${stats.total_memories}, entities=${stats.entities_count}, session_id=${sessionId}`);
                    }
                } catch (error) {
                    // Don't fail if tooltip update fails
                    console.warn('[HookEventProcessor] Failed to update tooltip:', error);
                }
            }
            
            // Verify that data was saved by checking ODAM directly
            // This will help us understand if the save actually happened
            this.log('after: verifying save - check ODAM API logs in output channels: "ODAM Memory File Updater" and "ODAM Client"', undefined, workspaceFolder);
            debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] Check output channels "ODAM Memory File Updater" and "ODAM Client" for detailed logs`);
        } catch (error: any) {
            const errorMsg = `after: ❌ ERROR saving to ODAM: ${error?.message || String(error)}`;
            this.log(errorMsg, {
                error: error?.message || String(error),
                stack: error?.stack?.substring(0, 200)
            }, workspaceFolder);
            debugChannel.appendLine(`[${new Date().toISOString()}] [HookEventProcessor] ${errorMsg}`);
            debugChannel.appendLine(`[${new Date().toISOString()}] Stack: ${error?.stack?.substring(0, 500)}`);
            throw error;
        }
    }

    async handleAfterThought(payload: HookThoughtPayload): Promise<void> {
        const workspaceFolder = this.dependencies.workspaceProvider();
        
        if (!this.dependencies.logger) {
            this.log('thought: logger not available, skipping', undefined, workspaceFolder);
            return;
        }

        this.log('thought: received', {
            conversationId: payload.conversation_id,
            generationId: payload.generation_id,
            length: (payload.text || '').length,
            duration: payload.duration_ms
        }, workspaceFolder);

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
        const workspaceFolder = this.dependencies.workspaceProvider();
        this.log('Cleared pending interactions', undefined, workspaceFolder);
    }

    dispose(): void {
        // Log to all channels before disposing
        for (const [name, channel] of this.debugChannels.entries()) {
            channel.appendLine(`[${new Date().toISOString()}] HookEventProcessor disposed`);
            channel.dispose();
        }
        this.debugChannels.clear();
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

    private log(message: string, data?: Record<string, unknown>, workspaceFolder?: vscode.WorkspaceFolder): void {
        const entry = data ? `${message} ${JSON.stringify(data)}` : message;
        const line = `[HookEventProcessor] ${entry}`;
        console.log(line);
        
        // ✅ FIX: Use workspace-specific output channel if available
        if (workspaceFolder) {
            const debugChannel = this.getOutputChannel(workspaceFolder);
            debugChannel.appendLine(`[${new Date().toISOString()}] ${entry}`);
        } else {
            // Fallback: log to first available channel or console only
            const firstChannel = Array.from(this.debugChannels.values())[0];
            if (firstChannel) {
                firstChannel.appendLine(`[${new Date().toISOString()}] ${entry}`);
            }
        }
    }
}




