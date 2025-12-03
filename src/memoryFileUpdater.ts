/**
 * Memory File Updater
 * Updates `.cursor/rules/odam-memory.mdc` with ODAM context
 * Cursor automatically reads this file and appends it to the system prompt
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OdamClient, CodeMemoryResponse, CodeArtifact, CodeInteractionPayload } from './odamClient';
import { MemoryContextEnhancer } from './memoryContextEnhancer';
import { ContextLogger } from './contextLogger';

export class MemoryFileUpdater {
    private client: OdamClient;
    private userId: string;
    private updateTimer: NodeJS.Timeout | null = null;
    private lastQuery: string = '';
    private lastContext: string = '';
    private contextEnhancer: MemoryContextEnhancer;
    private logger: ContextLogger | null = null;
    private outputChannel: vscode.OutputChannel;

    constructor(client: OdamClient, userId: string, logger?: ContextLogger) {
        this.client = client;
        this.userId = userId;
        this.contextEnhancer = new MemoryContextEnhancer();
        this.logger = logger || null;
        this.outputChannel = vscode.window.createOutputChannel('ODAM Memory File Updater');
    }

    /**
     * Update the memory file using the latest user query
     * IMPORTANT: queries are persisted in ODAM via updateMemoryAfterResponse()
     */
    async updateMemoryFile(userQuery: string, workspaceFolder?: vscode.WorkspaceFolder): Promise<void> {
        if (!workspaceFolder) {
            return;
        }

        const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);
        
        try {
            // ✅ FIX: Log query to track if it's empty
            const hasQuery = userQuery && userQuery.trim().length > 0;
            if (!hasQuery && !this.lastQuery) {
                console.warn('[Memory File Updater] Skipping memory update – no query available yet');
                return;
            }
            console.log('[Memory File Updater] Updating memory file:', { 
                query: hasQuery ? userQuery.substring(0, 50) : '(EMPTY)',
                queryLength: userQuery?.length || 0,
                userId: this.userId, 
                sessionId,
                willUseFallback: !hasQuery
            });
            
            // ✅ FIX: Do NOT save query here - it's already saved in updateMemoryAfterResponse()
            // Just retrieve context
            
            // IMPORTANT: query is required for context
            // If userQuery is empty, reuse the last successful query
            const effectiveQuery = hasQuery
                ? userQuery.trim() 
                : this.lastQuery || 'Fetch ODAM memory context';
            
            // ✅ FIX: Warn if using fallback query
            if (!hasQuery) {
                console.warn('[Memory File Updater] ⚠️ Using fallback query - user query is empty!', {
                    fallbackQuery: effectiveQuery,
                    lastQuery: this.lastQuery
                });
            }
            
            const result = await this.client.fetchMemoryContext(effectiveQuery, this.userId, sessionId);
            
            // Log ODAM response
            if (this.logger) {
                this.logger.logOdamResponse(userQuery, result, this.userId, sessionId);
            }
            
            console.log('[Memory File Updater] Result:', { 
                memoriesFound: result.memoriesFound,
                hasContext: !!result.context,
                contextLength: result.context?.length || 0,
                hasCodeMemory: !!result.codeMemory,
                codeMemorySections: result.codeMemory?.sections?.length || 0,
                codeMemoryEntities: result.codeMemory?.entities?.length || 0
            });
            
            // Always update the file, even if ODAM returned an empty context
            // That way Cursor can still show onboarding instructions
            let formattedContext = '';
            
            // Enhance the context with historical insights
            let enhancedCodeMemory = result.codeMemory;
            if (enhancedCodeMemory) {
                enhancedCodeMemory = this.contextEnhancer.enhanceContext(enhancedCodeMemory);
            }

            // Format context for the rules file
            // IMPORTANT: Use codeMemory.context_text when available
            let contextToUse = result.context || '';
            if (enhancedCodeMemory?.context_text && enhancedCodeMemory.context_text.length > 0) {
                contextToUse = enhancedCodeMemory.context_text;
                console.log('[Memory File Updater] Using context_text from codeMemory:', contextToUse.length, 'chars');
            }
            
            formattedContext = this.formatContextForRulesFile(
                contextToUse,
                result.memoriesFound,
                result.response,
                enhancedCodeMemory
            );

            // Add onboarding info if the context is still empty
            if (!result.context || result.context.length === 0) {
                formattedContext += '\n\n## ⚠️ Memory is still empty\n\n';
                formattedContext += 'After your first chats with Cursor, ODAM memory will populate automatically.\n';
                formattedContext += 'Every query and response is stored in ODAM to build long-term context.\n';
            }
            
            console.log('[Memory File Updater] Writing formatted context:', {
                contextLength: formattedContext.length,
                hasContent: formattedContext.length > 0
            });

            this.writeMemoryFile(workspaceFolder, formattedContext);
            this.lastQuery = userQuery;
            this.lastContext = formattedContext;
            
            // Log the context that will be passed to Cursor
            if (this.logger) {
                this.logger.logCursorContext(
                    userQuery,
                    formattedContext,
                    enhancedCodeMemory,
                    this.userId,
                    sessionId
                );
            }
            
            console.log('[Memory File Updater] Memory file updated successfully');
        } catch (error) {
            console.error('[Memory File Updater] Error updating memory file:', error);
            // Attempt to write a fallback file even if something failed
            try {
                const basicContext = this.formatContextForRulesFile('', 0, '', undefined);
                this.writeMemoryFile(workspaceFolder, basicContext);
            } catch (e) {
                console.error('[Memory File Updater] Failed to write basic context:', e);
            }
        }
    }

    /**
     * Update memory after receiving AI response
     * IMPORTANT: Save query + response + artifacts together in one request
     */
    async updateMemoryAfterResponse(
        userQuery: string,
        assistantResponse: string,
        artifacts: CodeArtifact[] = [],  // ✅ FIX: Add artifacts parameter
        workspaceFolder?: vscode.WorkspaceFolder
    ): Promise<void> {
        if (!workspaceFolder) {
            return;
        }

        const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);

        const logMsg1 = `[Memory File Updater] Updating memory after AI response: queryLength=${userQuery.length}, responseLength=${assistantResponse.length}, artifactsCount=${artifacts.length}, userId=${this.userId}, sessionId=${sessionId}`;
        console.log(logMsg1);
        this.outputChannel.appendLine(`[${new Date().toISOString()}] ${logMsg1}`);

        // ✅ FIX: Save query + response + artifacts together in one request
        try {
            // Collect git metadata (branch, tests, ticket) when available
            const metadata = await this.getGitMetadata(workspaceFolder);
            
            // Generate chunk_id for artifacts if not provided
            const artifactsWithChunkId = artifacts.map(artifact => {
                if (!artifact.chunk_id && artifact.identifier && artifact.path) {
                    // Generate chunk_id from identifier + path hash
                    const chunkIdSource = `${artifact.identifier}:${artifact.path}`;
                    artifact.chunk_id = Buffer.from(chunkIdSource).toString('base64').substring(0, 32);
                }
                return artifact;
            });
            
            const payload: CodeInteractionPayload = {
                user_id: this.userId,
                session_id: sessionId,
                query: userQuery,  // ✅ Pass query
                response: assistantResponse,  // ✅ Pass response
                artifacts: artifactsWithChunkId,  // ✅ Pass artifacts with chunk_id
                metadata: metadata  // ✅ Pass git metadata (branch, tests, ticket)
            };

            // ✅ FIX: Use recordCodeArtifact for all interactions
            const logMsg2 = `[Memory File Updater] 📤 Calling recordCodeArtifact with payload: user_id=${payload.user_id}, session_id=${payload.session_id}, query_length=${payload.query.length}, response_length=${payload.response.length}, artifacts_count=${payload.artifacts.length}`;
            console.log(logMsg2);
            this.outputChannel.appendLine(`[${new Date().toISOString()}] ${logMsg2}`);
            this.outputChannel.appendLine(`[${new Date().toISOString()}] Query preview: ${payload.query.substring(0, 100)}...`);
            this.outputChannel.appendLine(`[${new Date().toISOString()}] Response preview: ${payload.response.substring(0, 100)}...`);
            
            const result = await this.client.recordCodeArtifact(payload);
            
            const logMsg3 = `[Memory File Updater] 📥 recordCodeArtifact result received: result=${result ? 'not null' : 'null'}, success=${result?.success}, stored_artifacts=${result?.stored_artifacts}, memories_created=${result?.memories_created}`;
            console.log(logMsg3);
            this.outputChannel.appendLine(`[${new Date().toISOString()}] ${logMsg3}`);
            
            if (result && result.success) {
                const successMsg = `[Memory File Updater] ✅ ✅ ✅ Memory SAVED to ODAM successfully: stored_artifacts=${result.stored_artifacts}, memories_created=${result.memories_created}`;
                console.log(successMsg);
                this.outputChannel.appendLine(`[${new Date().toISOString()}] ${successMsg}`);
                this.outputChannel.appendLine(`[${new Date().toISOString()}] Memory stats: ${JSON.stringify(result.memory_stats)}`);
                
                if (this.logger) {
                    this.logger.logOdamSave(userQuery, this.userId, sessionId, 'user_query');
                }
            } else {
                const errorMsg = `[Memory File Updater] ❌ ❌ ❌ FAILED to save memory to ODAM: result_null=${result === null}, result_undefined=${result === undefined}, success=${result?.success}, stored_artifacts=${result?.stored_artifacts}, memories_created=${result?.memories_created}`;
                console.error(errorMsg);
                this.outputChannel.appendLine(`[${new Date().toISOString()}] ${errorMsg}`);
                this.outputChannel.appendLine(`[${new Date().toISOString()}] ⚠️ Check Developer Tools console for ODAM Client error logs!`);
            }

            // IMPORTANT: Delay for ODAM indexing
            // ODAM needs 2-3 seconds to process and index data before returning context
            const delayMsg = '[Memory File Updater] Waiting for ODAM indexing (2 seconds)...';
            console.log(delayMsg);
            this.outputChannel.appendLine(`[${new Date().toISOString()}] ${delayMsg}`);
            await new Promise(resolve => setTimeout(resolve, 2000));

            // After saving, update memory file with current data
            // This ensures the file contains new data from ODAM
            await this.updateMemoryFile(userQuery, workspaceFolder);

            const updateMsg = '[Memory File Updater] Memory file updated after response';
            console.log(updateMsg);
            this.outputChannel.appendLine(`[${new Date().toISOString()}] ${updateMsg}`);
        } catch (error: any) {
            const errorMsg = `[Memory File Updater] ❌ ERROR updating memory after response: ${error?.message || String(error)}`;
            console.error(errorMsg, error);
            this.outputChannel.appendLine(`[${new Date().toISOString()}] ${errorMsg}`);
            this.outputChannel.appendLine(`[${new Date().toISOString()}] Stack: ${error?.stack?.substring(0, 500)}`);
            throw error;
        }
    }

    /**
     * Record code artifacts in ODAM using /api/v1/code-memory/record
     */
    async recordCodeArtifact(
        userQuery: string,
        assistantResponse: string,
        artifacts: CodeArtifact[],
        workspaceFolder?: vscode.WorkspaceFolder,
        metadata?: { branch?: string; tests?: string; ticket?: string }
    ): Promise<boolean> {
        if (!workspaceFolder || !artifacts || artifacts.length === 0) {
            return false;
        }

        const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);

        console.log('[Memory File Updater] Recording code artifact:', {
            user_id: this.userId,
            session_id: sessionId,
            artifacts_count: artifacts.length,
            query: userQuery.substring(0, 50)
        });

        try {
            const payload: CodeInteractionPayload = {
                user_id: this.userId,
                session_id: sessionId,
                query: userQuery,
                response: assistantResponse,
                artifacts: artifacts,
                metadata: metadata || {}
            };

            const result = await this.client.recordCodeArtifact(payload);
            
            if (result && result.success) {
                console.log('[Memory File Updater] Code artifact recorded successfully:', {
                    stored_artifacts: result.stored_artifacts,
                    memories_created: result.memories_created
                });
                return true;
            } else {
                console.warn('[Memory File Updater] Failed to record code artifact');
                return false;
            }
        } catch (error) {
            console.error('[Memory File Updater] Error recording code artifact:', error);
            return false;
        }
    }

    /**
     * Extract code artifacts from assistant response
     */
    extractArtifactsFromResponse(
        response: string,
        workspaceFolder?: vscode.WorkspaceFolder
    ): CodeArtifact[] {
        const artifacts: CodeArtifact[] = [];

        if (!response || !workspaceFolder) {
            return artifacts;
        }

        // Simple parser that can be replaced with AST in the future
        const functionPattern = /(?:function|def|class|interface|type)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gi;
        const matches = response.matchAll(functionPattern);
        
        const seen = new Set<string>();
        for (const match of matches) {
            const identifier = match[1];
            if (!seen.has(identifier)) {
                seen.add(identifier);
                
                // Determine language based on keywords in the response
                let language: string | undefined;
                if (response.includes('def ') || response.includes('import ')) {
                    language = 'python';
                } else if (response.includes('function ') || response.includes('const ') || response.includes('interface ')) {
                    language = 'typescript';
                } else if (response.includes('class ') && response.includes('public ')) {
                    language = 'java';
                }

                artifacts.push({
                    identifier: identifier,
                    language: language,
                    status: 'success',
                    tags: ['generated'],
                    summary: `Generated from assistant response`
                });
            }
        }

        return artifacts;
    }

    /**
     * Write the memory file to `.cursor/rules`
     */
    private writeMemoryFile(workspaceFolder: vscode.WorkspaceFolder, content: string): void {
        const rulesDir = path.join(workspaceFolder.uri.fsPath, '.cursor', 'rules');
        const memoryFilePath = path.join(rulesDir, 'odam-memory.mdc');

        // Ensure `.cursor/rules` exists
        if (!fs.existsSync(rulesDir)) {
            fs.mkdirSync(rulesDir, { recursive: true });
        }

        // Compose content
        const fileContent = `# ODAM Memory Context

${content}

---

*Automatically updated by the ODAM Memory extension. Do not edit manually.*
*Last update: ${new Date().toLocaleString('en-US')}*
`;

        // Write file
        fs.writeFileSync(memoryFilePath, fileContent, 'utf8');
    }

    /**
     * Format the context for the `.mdc` rules file
     */
    private formatContextForRulesFile(
        context: string,
        memoriesFound: number,
        response?: any,
        codeMemory?: CodeMemoryResponse
    ): string {
        const parts: string[] = [];

        parts.push('# ODAM Memory Context\n');
        parts.push('\n## ODAM Long-Term Memory Context\n');
        
        if (memoriesFound > 0) {
            parts.push(`${memoriesFound} relevant memories found in long-term storage.\n`);
        }

        // Structured sections coming from Code Memory
        if (codeMemory?.sections && codeMemory.sections.length > 0) {
            parts.push('### Structured Code Memory Facts:\n');
            for (const section of codeMemory.sections) {
                parts.push(`#### ${section.title}`);
                for (const item of section.items) {
                    const values = item.values.join(', ');
                    parts.push(`- ${item.label}: ${values}`);
                }
                parts.push('');
            }

            if (codeMemory.entities) {
                const successfulArtifacts = codeMemory.entities.filter((e: any) => 
                    e.properties?.status === 'success' && 
                    (e.properties?.test_status === 'passed' || !e.properties?.test_status)
                );
                const problematicArtifacts = codeMemory.entities.filter((e: any) => 
                    e.properties?.status === 'failed' || 
                    e.properties?.outcome === 'regression'
                );

                if (successfulArtifacts.length > 0 || problematicArtifacts.length > 0) {
                    parts.push('#### Guidance Based on History:\n');
                    if (successfulArtifacts.length > 0) {
                        parts.push('- Prefer approaches that already proved effective.');
                        const solutionNames = successfulArtifacts
                            .slice(0, 3)
                            .map((a: any) => a.name)
                            .join(', ');
                        if (solutionNames) {
                            parts.push(`- Use ${solutionNames} as examples of successful implementations.`);
                        }
                    }
                    if (problematicArtifacts.length > 0) {
                        const problemNames = problematicArtifacts
                            .slice(0, 3)
                            .map((a: any) => a.name)
                            .join(', ');
                        if (problemNames) {
                            parts.push(`- Avoid approaches similar to ${problemNames} because they caused regressions.`);
                        }
                    }
                    parts.push('');
                }
            }
        }

        // Include extracted entities (fallback)
        if (response?.extracted_entities && response.extracted_entities.length > 0) {
            const entities = response.extracted_entities
                .slice(0, 10)
                .map((e: any) => `- ${e.name || e.type || JSON.stringify(e)}`)
                .join('\n');
            
            if (entities) {
                parts.push('### Mentioned entities (fallback):\n');
                parts.push(entities);
                parts.push('');
            }
        }

        if (codeMemory?.stats) {
            parts.push('### Memory statistics:\n');
            parts.push(`- Total entities: ${codeMemory.stats.entities_total}`);
            parts.push(`- Total memories/dialogues: ${codeMemory.stats.memories_total}`);
            parts.push(`- Graph nodes: ${codeMemory.stats.graph_nodes}`);
            parts.push(`- Relevant hits for the query: ${codeMemory.stats.search_hits}`);
            if (codeMemory.stats.has_session !== undefined) {
                parts.push(`- Active session: ${codeMemory.stats.has_session ? 'yes' : 'no'}`);
            }
            if (codeMemory.stats.generated_at) {
                parts.push(`- Generated at: ${codeMemory.stats.generated_at}`);
            }
            parts.push('');
        }

        parts.push('### Key facts:\n');
        if (context && context.trim().length > 0) {
            parts.push(context);
        } else {
            parts.push('Memory is empty for now. After the first chats with Cursor, ODAM will populate it automatically.');
        }
        parts.push('');

        parts.push('## Instructions for AI / IDE\n');
        parts.push('- Treat these facts as ground truth about the user and the project.');
        parts.push('- Ask clarifying questions before making changes if the context is incomplete.');
        parts.push('- Do not contradict the stored facts even if the current request suggests otherwise.');
        parts.push('- Prefer solutions that already worked in this project.');
        parts.push('- Use this information when answering questions or generating code.');
        parts.push('- Avoid repeating mistakes that were previously fixed.');
        parts.push('- Follow the user’s coding style and architectural preferences.');

        return parts.join('\n');
    }

    /**
     * Clear the memory file content
     */
    clearMemoryFile(workspaceFolder: vscode.WorkspaceFolder): void {
        this.writeMemoryFile(workspaceFolder, '');
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
     * Collect git metadata (branch/tests/ticket) when available
     */
    private async getGitMetadata(workspaceFolder: vscode.WorkspaceFolder): Promise<{ branch?: string; tests?: string; ticket?: string; execution_time?: string }> {
        const metadata: { branch?: string; tests?: string; ticket?: string; execution_time?: string } = {};

        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);
            const cwd = workspaceFolder.uri.fsPath;

            // Current branch
            try {
                const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd });
                if (branch && branch.trim()) {
                    metadata.branch = branch.trim();
                }
            } catch (error) {
                // Git not available or not a git repo
            }

            // Extract ticket from branch name or commit message
            // Example: feature/TICKET-123, bugfix/TICKET-456
            if (metadata.branch) {
                const ticketMatch = metadata.branch.match(/([A-Z]+-\d+)/i);
                if (ticketMatch) {
                    metadata.ticket = ticketMatch[1];
                }
            }

            // Test status is determined by CodeExecutionAnalyzer and passed via artifacts
            // This metadata field can be populated from artifacts if needed

        } catch (error) {
            // Git metadata collection failed - continue without it
            console.debug('[Memory File Updater] Git metadata collection failed:', error);
        }

        return metadata;
    }

    /**
     * Start periodic updates (disabled; kept for backward compatibility)
     */
    startPeriodicUpdate(workspaceFolder: vscode.WorkspaceFolder, intervalMs: number = 60000): void {
        console.log('[Memory File Updater] ⚠️ startPeriodicUpdate called - this should NOT be called! HookEventProcessor handles updates.');
        this.stopPeriodicUpdate();
        
        // ✅ FIX: Don't start periodic update - HookEventProcessor handles this
        // This method should not be called, but if it is, don't update with empty query
        // this.updateTimer = setInterval(async () => {
        //     if (this.lastQuery) {
        //         await this.updateMemoryFile(this.lastQuery, workspaceFolder);
        //     }
        // }, intervalMs);
    }

    /**
     * Stop periodic updates
     */
    stopPeriodicUpdate(): void {
        if (this.updateTimer) {
            clearInterval(this.updateTimer);
            this.updateTimer = null;
        }
    }

    dispose(): void {
        this.stopPeriodicUpdate();
    }
}



