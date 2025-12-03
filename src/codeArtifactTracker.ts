/**
 * Code Artifact Tracker
 * Monitors code edits and automatically records artifacts in ODAM memory
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { OdamClient, CodeArtifact } from './odamClient';
import { CodeExecutionAnalyzer, ExecutionAnalysis } from './codeExecutionAnalyzer';
import { ContextLogger } from './contextLogger';

interface CodeChange {
    filePath: string;
    language: string;
    changes: string[];
    timestamp: number;
}

export class CodeArtifactTracker {
    private client: OdamClient;
    private userId: string;
    private changeBuffer: Map<string, CodeChange> = new Map();
    private debounceTimer: NodeJS.Timeout | null = null;
    private lastUserQuery: string = '';
    private lastAssistantResponse: string = '';
    private readonly DEBOUNCE_MS = 2000; // 2 second debounce before recording
    private executionAnalyzer: CodeExecutionAnalyzer | null = null;
    private logger: ContextLogger | null = null;

    constructor(client: OdamClient, userId: string, context?: vscode.ExtensionContext, logger?: ContextLogger) {
        this.client = client;
        this.userId = userId;
        this.logger = logger || null;
        if (context) {
            this.executionAnalyzer = new CodeExecutionAnalyzer(context);
        }
    }

    /**
     * Remember the last chat interaction so artifacts can reference it
     */
    setLastInteraction(userQuery: string, assistantResponse: string): void {
        this.lastUserQuery = userQuery;
        this.lastAssistantResponse = assistantResponse;
    }

    /**
     * Track text document changes
     */
    trackDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        const document = event.document;
        
        // Ignore non-code files
        if (document.languageId === 'markdown' || 
            document.languageId === 'plaintext' ||
            document.uri.scheme !== 'file') {
            return;
        }

        const filePath = document.uri.fsPath;
        const language = this.detectLanguage(document.languageId, filePath);
        
        // Extract changed lines
        const changes = this.extractChanges(event.contentChanges, document);
        
        if (changes.length === 0) {
            return;
        }

        // Merge changes into buffer
        const existingChange = this.changeBuffer.get(filePath);
        if (existingChange) {
            existingChange.changes.push(...changes);
            existingChange.timestamp = Date.now();
        } else {
            this.changeBuffer.set(filePath, {
                filePath,
                language,
                changes,
                timestamp: Date.now()
            });
        }

        // Start debounce timer
        this.scheduleArtifactRecording();
    }

    /**
     * Track file saves to capture artifacts
     */
    async trackDocumentSave(document: vscode.TextDocument, workspaceFolder?: vscode.WorkspaceFolder): Promise<void> {
        if (document.languageId === 'markdown' || 
            document.languageId === 'plaintext' ||
            document.uri.scheme !== 'file') {
            return;
        }

        const filePath = document.uri.fsPath;
        const change = this.changeBuffer.get(filePath);
        
        if (!change || !workspaceFolder) {
            return;
        }

        // Extract artifacts from the saved file
        const artifacts = await this.extractArtifactsFromFile(filePath, change.language, workspaceFolder);
        
        if (artifacts.length > 0 && this.lastUserQuery) {
            // Persist artifacts in ODAM memory
            await this.recordArtifacts(artifacts, workspaceFolder);
            
            // Clear buffered changes for this file
            this.changeBuffer.delete(filePath);
        }
    }

    /**
     * Debounced artifact recording
     */
    private scheduleArtifactRecording(): void {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        this.debounceTimer = setTimeout(() => {
            this.processBufferedChanges();
        }, this.DEBOUNCE_MS);
    }

    /**
     * Flush the buffered changes
     */
    private async processBufferedChanges(): Promise<void> {
        if (this.changeBuffer.size === 0) {
            return;
        }

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder || !this.lastUserQuery) {
            return;
        }

        const artifacts: CodeArtifact[] = [];

        // Process every file with pending changes
        for (const [filePath, change] of this.changeBuffer.entries()) {
            try {
                const fileArtifacts = await this.extractArtifactsFromFile(
                    filePath,
                    change.language,
                    workspaceFolder
                );
                artifacts.push(...fileArtifacts);
            } catch (error) {
                console.error(`[Code Artifact Tracker] Error extracting artifacts from ${filePath}:`, error);
            }
        }

        if (artifacts.length > 0) {
            await this.recordArtifacts(artifacts, workspaceFolder);
        }

        // Clear the buffer after processing
        this.changeBuffer.clear();
    }

    /**
     * Extract artifacts from a single file
     */
    private async extractArtifactsFromFile(
        filePath: string,
        language: string,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<CodeArtifact[]> {
        const artifacts: CodeArtifact[] = [];

        try {
            if (!fs.existsSync(filePath)) {
                return artifacts;
            }

            const content = fs.readFileSync(filePath, 'utf8');
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);

            // Extract functions/classes depending on language
            const extracted = this.extractCodeEntities(content, language);
            
            // Analyse execution (tests/diff) to determine status
            let executionAnalysis: ExecutionAnalysis | null = null;
            if (this.executionAnalyzer) {
                try {
                    const document = await vscode.workspace.openTextDocument(filePath);
                    executionAnalysis = await this.executionAnalyzer.analyzeExecution(
                        document,
                        workspaceFolder
                    );
                } catch (error) {
                    console.warn(`[Code Artifact Tracker] Failed to analyze execution for ${filePath}:`, error);
                }
            }

            // Diff is already attached by executionAnalysis (if available)
            
            for (const entity of extracted) {
                const artifact: CodeArtifact = {
                    identifier: entity.name,
                    path: relativePath,
                    language: language,
                    summary: entity.summary || `Code in ${relativePath}`,
                    status: executionAnalysis?.status || 'draft',
                    tags: this.extractTags(content, entity.name),
                    outcome: executionAnalysis?.outcome || 'implemented'
                };

                // Generate chunk_id if not provided (for tracking code chunks)
                if (!artifact.chunk_id && artifact.identifier && artifact.path) {
                    const chunkIdSource = `${artifact.identifier}:${artifact.path}`;
                    artifact.chunk_id = Buffer.from(chunkIdSource).toString('base64').substring(0, 32);
                }

                // Add test status when available
                if (executionAnalysis?.test_status) {
                    artifact.test_status = executionAnalysis.test_status;
                }

                // Attach diff when present
                if (executionAnalysis?.diff) {
                    artifact.diff = executionAnalysis.diff;
                }

                artifacts.push(artifact);
            }
        } catch (error) {
            console.error(`[Code Artifact Tracker] Error reading file ${filePath}:`, error);
        }

        return artifacts;
    }

    /**
     * Extract code entities (functions/classes) from text
     */
    private extractCodeEntities(content: string, language: string): Array<{ name: string; summary?: string }> {
        const entities: Array<{ name: string; summary?: string }> = [];

        if (language === 'typescript' || language === 'javascript') {
            // Functions with docstrings/comments
            const functionRegex = /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*\{?/g;
            let match;
            while ((match = functionRegex.exec(content)) !== null) {
                const name = match[1];
                const summary = this.extractSummary(content, match.index || 0, name);
                entities.push({ name, summary });
            }

            // Classes with docstrings/comments
            const classRegex = /(?:export\s+)?class\s+([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
            while ((match = classRegex.exec(content)) !== null) {
                const name = match[1];
                const summary = this.extractSummary(content, match.index || 0, name);
                entities.push({ name, summary });
            }

            // const expressions that define functions
            const constFunctionRegex = /(?:export\s+)?const\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*[:=]\s*(?:async\s+)?\(/g;
            while ((match = constFunctionRegex.exec(content)) !== null) {
                const name = match[1];
                const summary = this.extractSummary(content, match.index || 0, name);
                entities.push({ name, summary });
            }
        } else if (language === 'python') {
            // Python functions
            const functionRegex = /(?:async\s+)?def\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\([^)]*\)\s*:/g;
            let match;
            while ((match = functionRegex.exec(content)) !== null) {
                const name = match[1];
                const summary = this.extractSummary(content, match.index || 0, name);
                entities.push({ name, summary });
            }

            // Python classes
            const classRegex = /class\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(?/g;
            while ((match = classRegex.exec(content)) !== null) {
                const name = match[1];
                const summary = this.extractSummary(content, match.index || 0, name);
                entities.push({ name, summary });
            }
        }

        return entities;
    }

    /**
     * Build summary from comments/docstrings before the entity
     */
    private extractSummary(content: string, position: number, name: string): string | undefined {
        // Look up to 10 lines above for comments/docstrings
        const lines = content.substring(0, position).split('\n');
        const relevantLines = lines.slice(-10).reverse();
        
        let summary: string[] = [];
        
        for (const line of relevantLines) {
            const trimmed = line.trim();
            
            // TypeScript/JavaScript comments
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) {
                const comment = trimmed.replace(/^\/\/\s*|\*\s*/g, '').trim();
                if (comment && !comment.startsWith('@')) {
                    summary.unshift(comment);
                }
            }
            
            // Python docstring
            if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
                const docstring = trimmed.replace(/^"""|'''|"""$|'''$/g, '').trim();
                if (docstring) {
                    summary.unshift(docstring);
                }
            }
            
            // Stop if we hit an empty line after collecting comments
            if (trimmed.length === 0 && summary.length > 0) {
                break;
            }
            
            // Stop if the next declaration starts
            if (trimmed.match(/^(function|class|const|def|export)\s+/)) {
                break;
            }
        }
        
        if (summary.length > 0) {
            return summary.join(' ').substring(0, 200);
        }
        
        return undefined;
    }

    /**
     * Derive tags from nearby comments
     */
    private extractTags(content: string, entityName: string): string[] {
        const tags: string[] = [];
        
        // Inspect lines preceding the entity
        const lines = content.split('\n');
        const entityIndex = lines.findIndex(line => line.includes(entityName));
        
        if (entityIndex > 0) {
            // Scan comment lines
            for (let i = Math.max(0, entityIndex - 5); i < entityIndex; i++) {
                const line = lines[i].toLowerCase();
                if (line.includes('@') || line.includes('//') || line.includes('#')) {
                    // Keyword heuristics
                    if (line.includes('util') || line.includes('helper')) tags.push('utility');
                    if (line.includes('api') || line.includes('endpoint')) tags.push('api');
                    if (line.includes('test')) tags.push('test');
                    if (line.includes('config')) tags.push('config');
                }
            }
        }

        return tags.length > 0 ? tags : ['code'];
    }

    /**
     * Extract line-level snippets from VS Code change events
     */
    private extractChanges(
        contentChanges: readonly vscode.TextDocumentContentChangeEvent[],
        document: vscode.TextDocument
    ): string[] {
        const changes: string[] = [];

        for (const change of contentChanges) {
            if (change.text.trim().length > 0) {
                // Grab new lines from the edit
                const lines = change.text.split('\n').filter(line => line.trim().length > 0);
                changes.push(...lines.slice(0, 10)); // Limit amount
            }
        }

        return changes;
    }

    /**
     * Normalize VS Code language IDs
     */
    private detectLanguage(languageId: string, filePath: string): string {
        // Map VS Code IDs to canonical language names
        const languageMap: { [key: string]: string } = {
            'typescript': 'typescript',
            'javascript': 'javascript',
            'python': 'python',
            'java': 'java',
            'csharp': 'csharp',
            'go': 'go',
            'rust': 'rust',
            'cpp': 'cpp',
            'c': 'c'
        };

        if (languageMap[languageId]) {
            return languageMap[languageId];
        }

        // Fallback: detect by file extension
        const ext = path.extname(filePath).toLowerCase();
        const extMap: { [key: string]: string } = {
            '.ts': 'typescript',
            '.js': 'javascript',
            '.py': 'python',
            '.java': 'java',
            '.cs': 'csharp',
            '.go': 'go',
            '.rs': 'rust',
            '.cpp': 'cpp',
            '.c': 'c'
        };

        return extMap[ext] || languageId;
    }

    /**
     * Persist artifacts in ODAM memory
     */
    private async recordArtifacts(
        artifacts: CodeArtifact[],
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<void> {
        if (artifacts.length === 0 || !this.lastUserQuery) {
            return;
        }

        try {
            // Pull metadata from git when available
            const metadata = await this.getGitMetadata(workspaceFolder);

            const enhancedMetadata: any = { ...metadata };
            // execution_time can be added later via executionAnalysis

            // Call API to store artifacts
            const payload = {
                user_id: this.userId,
                session_id: this.getSessionId(workspaceFolder.uri.fsPath),
                query: this.lastUserQuery,
                response: this.lastAssistantResponse || 'Code generated',
                artifacts: artifacts,
                metadata: enhancedMetadata
            };

            // ✅ FIX: Pass workspaceFolder to ensure logs appear in correct project's output channel
            const result = await this.client.recordCodeArtifact(payload, workspaceFolder);
            
            if (result && result.success) {
                console.log(`[Code Artifact Tracker] Recorded ${result.stored_artifacts} artifacts, created ${result.memories_created} memories`);
            } else {
                console.warn('[Code Artifact Tracker] Failed to record artifacts');
            }
        } catch (error) {
            console.error('[Code Artifact Tracker] Error recording artifacts:', error);
        }
    }

    /**
     * Collect git metadata (branch/tests/ticket)
     */
    private async getGitMetadata(workspaceFolder: vscode.WorkspaceFolder): Promise<{ branch?: string; tests?: string; ticket?: string }> {
        const metadata: { branch?: string; tests?: string; ticket?: string } = {};

        try {
            const { exec } = require('child_process');
            const { promisify } = require('util');
            const execAsync = promisify(exec);

            // Current branch
            try {
                const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', {
                    cwd: workspaceFolder.uri.fsPath
                });
                metadata.branch = branch.trim();
            } catch (e) {
                // Git unavailable or repo not initialized
            }
        } catch (error) {
            // Ignore git errors
        }

        return metadata;
    }

    /**
     * Derive session_id for workspace
     */
    private getSessionId(workspacePath: string): string {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(workspacePath);
        return hash.digest('hex').substring(0, 16);
    }

    /**
     * Clear buffered changes
     */
    clearBuffer(): void {
        this.changeBuffer.clear();
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    dispose(): void {
        this.clearBuffer();
        if (this.executionAnalyzer) {
            this.executionAnalyzer.dispose();
        }
    }
}

