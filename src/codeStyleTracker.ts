/**
 * Code Style Tracker
 * Observes the user’s code style and stores preferences inside ODAM memory.
 *
 * Tracks:
 * - Indentation (tabs vs spaces, typical size)
 * - Naming conventions (camelCase, snake_case, PascalCase)
 * - Formatting shape (line length, quotes, semicolons)
 * - Code patterns (async/await vs Promise, functional vs imperative)
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { OdamClient } from './odamClient';

export interface CodeStylePreferences {
    indentation: {
        type: 'tabs' | 'spaces';
        size: number;
    };
    naming: {
        functions: 'camelCase' | 'snake_case' | 'PascalCase';
        classes: 'PascalCase' | 'camelCase';
        constants: 'UPPER_SNAKE_CASE' | 'camelCase';
    };
    formatting: {
        maxLineLength: number;
        quoteStyle: 'single' | 'double';
        semicolons: boolean;
        trailingCommas: boolean;
    };
    patterns: {
        asyncStyle: 'async/await' | 'promise' | 'mixed';
        functionalStyle: boolean;
    };
}

export class CodeStyleTracker {
    private client: OdamClient;
    private userId: string;
    private styleCache: Map<string, CodeStylePreferences> = new Map();
    private readonly DEBOUNCE_MS = 5000; // 5 seconds before persisting style

    constructor(client: OdamClient, userId: string) {
        this.client = client;
        this.userId = userId;
    }

    /**
     * Analyse style traits from a document
     */
    async analyzeCodeStyle(document: vscode.TextDocument): Promise<CodeStylePreferences | null> {
        const content = document.getText();
        if (!content || content.length < 50) {
            return null; // Not enough content to analyse
        }

        const language = document.languageId;
        const style: CodeStylePreferences = {
            indentation: this.detectIndentation(content),
            naming: this.detectNamingConventions(content, language),
            formatting: this.detectFormatting(content, language),
            patterns: this.detectPatterns(content, language)
        };

        return style;
    }

    /**
     * Detect indentation preferences
     */
    private detectIndentation(content: string): { type: 'tabs' | 'spaces'; size: number } {
        const lines = content.split('\n').slice(0, 100); // First 100 lines
        let tabCount = 0;
        let spaceCounts: Map<number, number> = new Map();

        for (const line of lines) {
            if (line.trim().length === 0) continue;

            const match = line.match(/^(\s+)/);
            if (match) {
                const indent = match[1];
                if (indent.includes('\t')) {
                    tabCount++;
                } else {
                    const spaces = indent.length;
                    spaceCounts.set(spaces, (spaceCounts.get(spaces) || 0) + 1);
                }
            }
        }

        if (tabCount > spaceCounts.size) {
            return { type: 'tabs', size: 1 };
        }

        // Determine the most common number of spaces
        let mostCommon = 4; // Default
        let maxCount = 0;
        for (const [size, count] of spaceCounts.entries()) {
            if (count > maxCount) {
                maxCount = count;
                mostCommon = size;
            }
        }

        return { type: 'spaces', size: mostCommon };
    }

    /**
     * Detect naming conventions
     */
    private detectNamingConventions(content: string, language: string): CodeStylePreferences['naming'] {
        const naming: CodeStylePreferences['naming'] = {
            functions: 'camelCase',
            classes: 'PascalCase',
            constants: 'UPPER_SNAKE_CASE'
        };

        // Functions
        const functionPatterns = [
            /(?:function|def|const\s+\w+\s*[:=]\s*(?:async\s+)?\()\s*([a-z][a-zA-Z0-9]*)/g, // camelCase
            /(?:function|def|const\s+\w+\s*[:=]\s*(?:async\s+)?\()\s*([a-z_][a-z0-9_]*)/g, // snake_case
            /(?:function|def|const\s+\w+\s*[:=]\s*(?:async\s+)?\()\s*([A-Z][a-zA-Z0-9]*)/g  // PascalCase
        ];

        const functionCounts = [0, 0, 0];
        for (let i = 0; i < functionPatterns.length; i++) {
            const matches = content.matchAll(functionPatterns[i]);
            functionCounts[i] = Array.from(matches).length;
        }

        if (functionCounts[0] > functionCounts[1] && functionCounts[0] > functionCounts[2]) {
            naming.functions = 'camelCase';
        } else if (functionCounts[1] > functionCounts[2]) {
            naming.functions = 'snake_case';
        } else {
            naming.functions = 'PascalCase';
        }

        // Classes
        const classPatterns = [
            /class\s+([A-Z][a-zA-Z0-9]*)/g, // PascalCase
            /class\s+([a-z][a-zA-Z0-9]*)/g   // camelCase
        ];

        const classMatches = Array.from(content.matchAll(classPatterns[0]));
        naming.classes = classMatches.length > 0 ? 'PascalCase' : 'camelCase';

        // Constants
        const constantPatterns = [
            /(?:const|let|var)\s+([A-Z_][A-Z0-9_]*)\s*=/g, // UPPER_SNAKE_CASE
            /(?:const|let|var)\s+([a-z][a-zA-Z0-9]*)\s*=/g  // camelCase
        ];

        const constantMatches = Array.from(content.matchAll(constantPatterns[0]));
        naming.constants = constantMatches.length > 0 ? 'UPPER_SNAKE_CASE' : 'camelCase';

        return naming;
    }

    /**
     * Detect formatting preferences
     */
    private detectFormatting(content: string, language: string): CodeStylePreferences['formatting'] {
        const lines = content.split('\n');
        const lineLengths = lines.map(l => l.length);
        const maxLineLength = Math.max(...lineLengths);

        // Quote style
        const singleQuotes = (content.match(/'/g) || []).length;
        const doubleQuotes = (content.match(/"/g) || []).length;
        const quoteStyle = singleQuotes > doubleQuotes ? 'single' : 'double';

        // Semicolons
        const semicolons = (content.match(/;/g) || []).length;
        const linesWithCode = lines.filter(l => l.trim().length > 0).length;
        const semicolonRatio = semicolons / linesWithCode;
        const usesSemicolons = semicolonRatio > 0.3;

        // Trailing commas
        const trailingCommas = (content.match(/,\s*\)/g) || []).length > 0;

        return {
            maxLineLength: Math.min(maxLineLength, 120), // Cap lines at 120
            quoteStyle,
            semicolons: usesSemicolons,
            trailingCommas
        };
    }

    /**
     * Detect higher-level coding patterns
     */
    private detectPatterns(content: string, language: string): CodeStylePreferences['patterns'] {
        const asyncAwaitCount = (content.match(/async\s+function|await\s+/g) || []).length;
        const promiseCount = (content.match(/\.then\(|\.catch\(|Promise\./g) || []).length;
        
        let asyncStyle: 'async/await' | 'promise' | 'mixed' = 'async/await';
        if (promiseCount > asyncAwaitCount * 2) {
            asyncStyle = 'promise';
        } else if (promiseCount > 0 && asyncAwaitCount > 0) {
            asyncStyle = 'mixed';
        }

        // Functional style (map/filter/reduce)
        const functionalPatterns = (content.match(/\.map\(|\.filter\(|\.reduce\(/g) || []).length;
        const imperativePatterns = (content.match(/for\s*\(|while\s*\(/g) || []).length;
        const functionalStyle = functionalPatterns > imperativePatterns;

        return {
            asyncStyle,
            functionalStyle
        };
    }

    /**
     * Persist code style to ODAM memory
     */
    async saveCodeStyle(
        style: CodeStylePreferences,
        workspaceFolder: vscode.WorkspaceFolder,
        language?: string
    ): Promise<void> {
        const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);

        const styleDescription = this.formatStyleDescription(style, language);

        // Store style as an entity in ODAM
        const message = `User code style (${language || 'general'}): ${styleDescription}`;

        await this.client.updateMemory(message, this.userId, sessionId);
    }

    /**
     * Build a human-readable description for memory
     */
    private formatStyleDescription(style: CodeStylePreferences, language?: string): string {
        const parts: string[] = [];

        parts.push(`Indentation: ${style.indentation.type === 'tabs' ? 'tabs' : `${style.indentation.size} spaces`}`);
        parts.push(`Functions: ${style.naming.functions}`);
        parts.push(`Classes: ${style.naming.classes}`);
        parts.push(`Constants: ${style.naming.constants}`);
        parts.push(`Max line length: ${style.formatting.maxLineLength}`);
        parts.push(`Quotes: ${style.formatting.quoteStyle === 'single' ? 'single' : 'double'}`);
        parts.push(`Semicolons: ${style.formatting.semicolons ? 'yes' : 'no'}`);
        parts.push(`Trailing commas: ${style.formatting.trailingCommas ? 'yes' : 'no'}`);
        parts.push(`Async style: ${style.patterns.asyncStyle}`);
        parts.push(`Functional style: ${style.patterns.functionalStyle ? 'yes' : 'no'}`);

        return parts.join(', ');
    }

    /**
     * Track style for a file once per session
     */
    async trackFileStyle(document: vscode.TextDocument, workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        const filePath = document.uri.fsPath;
        const language = document.languageId;

        // Use cache to avoid duplicate analysis
        const cacheKey = `${filePath}:${language}`;
        const cached = this.styleCache.get(cacheKey);
        if (cached) {
            return; // Already analysed
        }

        const style = await this.analyzeCodeStyle(document);
        if (style) {
            this.styleCache.set(cacheKey, style);
            await this.saveCodeStyle(style, workspaceFolder, language);
        }
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
}






























