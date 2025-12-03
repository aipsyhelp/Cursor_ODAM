/**
 * Context Logger
 * Logs every context payload sent between Cursor and ODAM
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CodeMemoryResponse } from './odamClient';

export interface ContextLogEntry {
    timestamp: string;
    type: 'cursor_context' | 'odam_save' | 'odam_response' | 'code_artifact';
    direction: 'to_cursor' | 'to_odam' | 'from_odam';
    data: {
        query?: string;
        context?: string;
        response?: string;
        artifacts?: any[];
        codeMemory?: Partial<CodeMemoryResponse>;
        stats?: any;
    };
    metadata: {
        userId?: string;
        sessionId?: string;
        workspacePath?: string;
    };
}

export class ContextLogger {
    private logFile: string;
    private maxLogSize: number = 10 * 1024 * 1024; // 10MB
    private logEntries: ContextLogEntry[] = [];
    private outputChannel: vscode.OutputChannel;

    constructor(workspaceFolder?: vscode.WorkspaceFolder) {
        const workspacePath = workspaceFolder?.uri.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        const logDir = path.join(workspacePath, '.odam', 'logs');
        
        // Ensure log directory exists
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, { recursive: true });
        }

        this.logFile = path.join(logDir, `context-${new Date().toISOString().split('T')[0]}.jsonl`);
        this.outputChannel = vscode.window.createOutputChannel('ODAM Context Logger');
    }

    /**
     * Log the context sent to Cursor
     */
    logCursorContext(
        query: string,
        context: string,
        codeMemory?: CodeMemoryResponse,
        userId?: string,
        sessionId?: string
    ): void {
        const entry: ContextLogEntry = {
            timestamp: new Date().toISOString(),
            type: 'cursor_context',
            direction: 'to_cursor',
            data: {
                query: query.substring(0, 500), // limit length
                context: context.substring(0, 2000), // limit length
                codeMemory: codeMemory ? {
                    stats: codeMemory.stats,
                    sections: codeMemory.sections?.slice(0, 5), // first 5 sections
                    entities: codeMemory.entities?.slice(0, 10), // first 10 entities
                    graph: codeMemory.graph ? {
                        nodes: codeMemory.graph.nodes?.slice(0, 10) // first 10 nodes
                    } : undefined
                } : undefined
            },
            metadata: {
                userId,
                sessionId,
                workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            }
        };

        this.writeLogEntry(entry);
        this.logToOutputChannel('📤 TO CURSOR', entry);
    }

    /**
     * Log a payload saved to ODAM
     */
    logOdamSave(
        message: string,
        userId: string,
        sessionId?: string,
        type: 'user_query' | 'assistant_response' = 'user_query'
    ): void {
        const entry: ContextLogEntry = {
            timestamp: new Date().toISOString(),
            type: 'odam_save',
            direction: 'to_odam',
            data: {
                query: type === 'user_query' ? message.substring(0, 500) : undefined,
                response: type === 'assistant_response' ? message.substring(0, 2000) : undefined
            },
            metadata: {
                userId,
                sessionId,
                workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            }
        };

        this.writeLogEntry(entry);
        this.logToOutputChannel(`💾 TO ODAM (${type})`, entry);
    }

    /**
     * Log a response returned by ODAM
     */
    logOdamResponse(
        query: string,
        response: any,
        userId: string,
        sessionId?: string
    ): void {
        const entry: ContextLogEntry = {
            timestamp: new Date().toISOString(),
            type: 'odam_response',
            direction: 'from_odam',
            data: {
                query: query.substring(0, 500),
                codeMemory: response.codeMemory ? {
                    stats: response.codeMemory.stats,
                    sections: response.codeMemory.sections?.slice(0, 5),
                    entities: response.codeMemory.entities?.slice(0, 10),
                    graph: response.codeMemory.graph ? {
                        nodes: response.codeMemory.graph.nodes?.slice(0, 10)
                    } : undefined
                } : undefined,
                stats: {
                    memoriesFound: response.memoriesFound,
                    contextLength: response.context?.length || 0
                }
            },
            metadata: {
                userId,
                sessionId,
                workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            }
        };

        this.writeLogEntry(entry);
        this.logToOutputChannel('📥 FROM ODAM', entry);
    }

    /**
     * Log recorded code artifacts
     */
    logCodeArtifacts(
        artifacts: any[],
        userId: string,
        sessionId?: string
    ): void {
        const entry: ContextLogEntry = {
            timestamp: new Date().toISOString(),
            type: 'code_artifact',
            direction: 'to_odam',
            data: {
                artifacts: artifacts.map(a => ({
                    identifier: a.identifier,
                    path: a.path,
                    language: a.language,
                    status: a.status,
                    outcome: a.outcome
                }))
            },
            metadata: {
                userId,
                sessionId,
                workspacePath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
            }
        };

        this.writeLogEntry(entry);
        this.logToOutputChannel('📦 CODE ARTIFACTS', entry);
    }

    /**
     * Append entry to log file
     */
    private writeLogEntry(entry: ContextLogEntry): void {
        try {
            const logLine = JSON.stringify(entry) + '\n';
            
            // Rotate file if it grows too large
            if (fs.existsSync(this.logFile)) {
                const stats = fs.statSync(this.logFile);
                if (stats.size > this.maxLogSize) {
                    const oldLogFile = this.logFile.replace('.jsonl', `-${Date.now()}.jsonl`);
                    fs.renameSync(this.logFile, oldLogFile);
                }
            }

            fs.appendFileSync(this.logFile, logLine, 'utf8');
            this.logEntries.push(entry);

            // Keep only the latest 100 entries in memory
            if (this.logEntries.length > 100) {
                this.logEntries.shift();
            }
        } catch (error) {
            console.error('[Context Logger] Error writing log entry:', error);
        }
    }

    /**
     * Mirror entry into the Output channel
     */
    private logToOutputChannel(prefix: string, entry: ContextLogEntry): void {
        const time = new Date(entry.timestamp).toLocaleTimeString();
        this.outputChannel.appendLine(`[${time}] ${prefix}`);
        
        if (entry.data.query) {
            this.outputChannel.appendLine(`  Query: ${entry.data.query.substring(0, 100)}...`);
        }
        if (entry.data.response) {
            this.outputChannel.appendLine(`  Response: ${entry.data.response.substring(0, 100)}...`);
        }
        if (entry.data.context) {
            this.outputChannel.appendLine(`  Context length: ${entry.data.context.length} chars`);
        }
        if (entry.data.codeMemory?.stats) {
            const stats = entry.data.codeMemory.stats;
            this.outputChannel.appendLine(`  Stats: entities=${stats.entities_total}, memories=${stats.memories_total}, graph_nodes=${stats.graph_nodes}`);
        }
        if (entry.data.artifacts) {
            this.outputChannel.appendLine(`  Artifacts: ${entry.data.artifacts.length}`);
        }
        
        this.outputChannel.appendLine('');
    }

    /**
     * Show the Output channel
     */
    showOutputChannel(): void {
        this.outputChannel.show();
    }

    /**
     * Return the most recent entries (in-memory)
     */
    getRecentEntries(count: number = 20): ContextLogEntry[] {
        return this.logEntries.slice(-count);
    }

    /**
     * Return all entries from the log file
     */
    getAllEntries(): ContextLogEntry[] {
        try {
            if (!fs.existsSync(this.logFile)) {
                return [];
            }

            const content = fs.readFileSync(this.logFile, 'utf8');
            const lines = content.trim().split('\n').filter(line => line.trim());
            return lines.map(line => JSON.parse(line));
        } catch (error) {
            console.error('[Context Logger] Error reading log file:', error);
            return [];
        }
    }

    /**
     * Clear logs
     */
    clearLogs(): void {
        try {
            if (fs.existsSync(this.logFile)) {
                fs.unlinkSync(this.logFile);
            }
            this.logEntries = [];
            this.outputChannel.clear();
            this.outputChannel.appendLine('Logs cleared');
        } catch (error) {
            console.error('[Context Logger] Error clearing logs:', error);
        }
    }

    /**
     * Get log file path
     */
    getLogFilePath(): string {
        return this.logFile;
    }
}

























