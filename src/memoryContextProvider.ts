/**
 * Memory Context Provider
 * Supplies ODAM memory context for Cursor AI
 */

import { OdamClient } from './odamClient';
import * as vscode from 'vscode';

import { CodeArtifactTracker } from './codeArtifactTracker';

export class MemoryContextProvider {
    private client: OdamClient;
    private userId: string;
    private cache: Map<string, { context: string; timestamp: number }> = new Map();
    private cacheTimeout = 60000; // 1 minute
    private artifactTracker: CodeArtifactTracker | null = null;

    constructor(client: OdamClient, userId: string, artifactTracker?: CodeArtifactTracker) {
        this.client = client;
        this.userId = userId;
        this.artifactTracker = artifactTracker || null;
    }

    /**
     * Retrieve memory context for a user query
     */
    async getMemoryContext(userQuery: string, workspacePath?: string): Promise<string> {
        const sessionId = workspacePath ? this.getSessionId(workspacePath) : undefined;
        
        // Serve from cache first
        const cacheKey = `${this.userId}:${sessionId || 'global'}:${userQuery.substring(0, 50)}`;
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.context;
        }

        try {
            const result = await this.client.fetchMemoryContext(
                userQuery,
                this.userId,
                sessionId
            );

            // Cache result
            if (result.context) {
                this.cache.set(cacheKey, {
                    context: result.context,
                    timestamp: Date.now()
                });
            }

            return result.context;
        } catch (error) {
            console.error('Error fetching memory context:', error);
            return '';
        }
    }

    /**
     * Update memory after receiving response
     * NOTE: This method is deprecated - use MemoryFileUpdater.updateMemoryAfterResponse() instead
     */
    async updateMemoryAfterResponse(
        userQuery: string,
        assistantResponse: string,
        workspacePath?: string
    ): Promise<void> {
        // ✅ FIX: Set context for artifact tracker, but don't save memory here
        // Memory saving is handled by MemoryFileUpdater.updateMemoryAfterResponse()
        if (this.artifactTracker) {
            this.artifactTracker.setLastInteraction(userQuery, assistantResponse);
        }
        
        // Note: Actual memory saving should be done via MemoryFileUpdater.updateMemoryAfterResponse()
        // which saves query + response together in one request
    }

    /**
     * Derive session_id for workspace
     */
    private getSessionId(workspacePath: string): string {
        const path = require('path');
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(workspacePath);
        return hash.digest('hex').substring(0, 16);
    }

    /**
     * Clear cached contexts
     */
    clearCache(): void {
        this.cache.clear();
    }
}



