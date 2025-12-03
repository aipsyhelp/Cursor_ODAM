/**
 * ODAM API Client
 * Client for interacting with ODAM API
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import * as vscode from 'vscode';

export interface ChatRequest {
    message: string;
    user_id: string;
    session_id?: string;
    language?: string;
    use_memory?: boolean;
    use_medical_nlp?: boolean;
    use_graph_search?: boolean;
    fast_mode?: boolean;
}

export interface ChatResponse {
    response: string;
    user_id?: string;
    session_id?: string;
    memories_found: number;
    memories_created?: number;
    entities_extracted: number;
    personalization_score: number;
    memory_utilization_score?: number;
    processing_time_ms: number;
    extracted_entities?: any[];
    memory_graph?: any[];
    search_metrics?: any;
    detected_language?: string;
    language_confidence?: number;
    extraction_method?: string;
    confidence_avg?: number;
}

export interface MemoryStats {
    user_id?: string;
    total_memories: number;
    entities_count: number;
    graph_nodes?: number;
    last_interaction?: string;
    last_updated?: string;
    memory_health_score: number;
}

export interface CodeMemoryItem {
    label: string;
    values: string[];
}

export interface CodeMemorySection {
    title: string;
    items: CodeMemoryItem[];
}

export interface CodeMemoryStats {
    entities_total: number;
    memories_total: number;
    search_hits: number;
    graph_nodes: number;
    has_session?: boolean;
    generated_at?: string;
}

export interface CodeMemoryResponse {
    user_id: string;
    generated_at: string;
    stats: CodeMemoryStats;
    sections: CodeMemorySection[];
    graph?: {
        nodes?: Array<{
            id: string;
            name: string;
            type: string;
            user_id: string;
            properties: Record<string, any>;
            confidence: number;
            created_at: string;
            layer: string;
            persistent: boolean;
        }>;
    };
    entities?: Array<{
        id: string;
        name: string;
        type: string;
        category: string;
        properties: Record<string, any>;
        confidence: number;
        source: string;
        last_seen?: string;
    }>;
    memories?: any[];
    search_hits?: any[];
    context_text: string;
}

export interface CodeArtifact {
    identifier: string;
    path?: string;
    language?: string;
    summary?: string;
    status?: 'success' | 'failed' | 'draft';
    tags?: string[];
    outcome?: string;
    chunk_id?: string;
    diff?: string;
    test_status?: string;
}

export interface CodeInteractionPayload {
    user_id: string;
    session_id?: string;
    query: string;
    response: string;
    artifacts: CodeArtifact[];
    metadata?: {
        branch?: string;
        tests?: string;
        ticket?: string;
        execution_time?: string;
        step?: number;
    };
}

export interface CodeMemoryRecordResponse {
    success: boolean;
    stored_artifacts: number;
    memories_created: number;
    memory_stats: {
        memories_created: number;
        memory_types: string[];
        success: boolean;
        neo4j_commits: number;
        memory_utilization_score: number;
    };
}

export interface MemoryContextResult {
    context: string;
    memoriesFound: number;
    response?: ChatResponse;
    codeMemory?: CodeMemoryResponse;
}

interface OdamClientOptions {
    chatFallbackEnabled?: boolean;
}

export class OdamClient {
    private client: AxiosInstance;
    private apiUrl: string;
    private apiKey: string;
    private chatFallbackEnabled: boolean;
    private outputChannels: Map<string, vscode.OutputChannel> = new Map();

    constructor(apiUrl: string, apiKey: string, options: OdamClientOptions = {}, workspaceFolder?: vscode.WorkspaceFolder) {
        this.apiUrl = apiUrl.replace(/\/$/, ''); // Remove trailing slash
        this.apiKey = apiKey;
        this.chatFallbackEnabled = options.chatFallbackEnabled ?? false;
        
        // ✅ FIX: Output channels will be created dynamically based on current workspace during method calls
        // This ensures logs appear in the correct project's output channel
        if (workspaceFolder) {
            this.getOutputChannel(workspaceFolder);
        }
        
        this.client = axios.create({
            baseURL: this.apiUrl,
            timeout: 60000, // Increased timeout
            headers: {
                'Content-Type': 'application/json',
                ...(apiKey && { 'Authorization': `Bearer ${apiKey}` })
            }
        });
    }

    /**
     * Get or create workspace-specific output channel
     * This ensures logs appear in the correct project's output channel
     */
    private getOutputChannel(workspaceFolder?: vscode.WorkspaceFolder): vscode.OutputChannel {
        // If no workspaceFolder provided, try to get current workspace
        if (!workspaceFolder) {
            workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        }

        const path = require('path');
        const workspaceName = workspaceFolder 
            ? path.basename(workspaceFolder.uri.fsPath)
            : 'default';
        const channelName = `ODAM Client (${workspaceName})`;
        
        // VS Code will return existing channel if it exists, or create new one
        // This ensures we always use the correct channel for the current workspace
        if (!this.outputChannels.has(channelName)) {
            const channel = vscode.window.createOutputChannel(channelName);
            this.outputChannels.set(channelName, channel);
        }
        
        return this.outputChannels.get(channelName)!;
    }

    /**
     * Get relevant memory context for a query
     * Calls ODAM code-memory/context endpoint to retrieve memory context
     */
    async fetchMemoryContext(
        query: string,
        userId: string,
        sessionId?: string
    ): Promise<MemoryContextResult> {
        try {
            // IMPORTANT: query is required for context - without it context will be empty
            // If query is empty, use a default query
            const effectiveQuery = query && query.trim().length > 0 
                ? query.trim() 
                : 'Get user memory context';
            
            console.log('[ODAM Client] Fetching memory context:', { 
                query: effectiveQuery.substring(0, 50), 
                originalQuery: query?.substring(0, 50) || 'empty',
                userId, 
                sessionId 
            });

            // 1. Professional context from Code Memory API (new mechanism)
            const codeMemory = await this.fetchCodeMemoryContextFromApi(effectiveQuery, userId, sessionId);
            if (codeMemory) {
                console.log('[ODAM Client] Code memory context received:', {
                    hasContextText: !!codeMemory.context_text,
                    contextTextLength: codeMemory.context_text?.length || 0,
                    sections: codeMemory.sections?.length || 0,
                    entities: codeMemory.entities?.length || 0,
                    stats: codeMemory.stats
                });

                // IMPORTANT: Return context even if context_text is empty, but sections or entities exist
                if (codeMemory.context_text || (codeMemory.sections && codeMemory.sections.length > 0) || (codeMemory.entities && codeMemory.entities.length > 0)) {
                    // Format context from sections if context_text is empty
                    let contextText = codeMemory.context_text || '';
                    if (!contextText && codeMemory.sections && codeMemory.sections.length > 0) {
                        contextText = this.formatCodeMemorySectionsAsContext(codeMemory);
                    }

                    return {
                        context: contextText,
                        memoriesFound: codeMemory.stats?.entities_total || codeMemory.entities?.length || 0,
                        codeMemory
                    };
                }
            }

            // 2. Fallback: if Code Memory is empty, return empty context
            // IMPORTANT: Do NOT use /api/v1/chat (this is for AI responses, which we don't use)
            // Correct workflow uses only /api/v1/code-memory/context and /api/v1/code-memory/record
            console.log('[ODAM Client] Code memory empty or unavailable, returning empty context');
            
            // Return empty context - memory will be populated through /api/v1/code-memory/record
            return {
                context: '',
                memoriesFound: 0
            };

        } catch (error) {
            const axiosError = error as AxiosError;
            console.error('[ODAM Client] fetchMemoryContext error:', {
                message: axiosError.message,
                status: axiosError.response?.status,
                statusText: axiosError.response?.statusText,
                data: axiosError.response?.data
            });
            
            // Return empty context on error
            return {
                context: '',
                memoriesFound: 0
            };
        }
    }

    /**
     * Format Code Memory sections as context
     */
    private formatCodeMemorySectionsAsContext(codeMemory: CodeMemoryResponse): string {
        const parts: string[] = [];
        
        if (codeMemory.sections && codeMemory.sections.length > 0) {
            for (const section of codeMemory.sections) {
                parts.push(`### ${section.title}`);
                for (const item of section.items) {
                    const values = item.values.join(', ');
                    parts.push(`- ${item.label}: ${values}`);
                }
                parts.push('');
            }
        }
        
        if (codeMemory.entities && codeMemory.entities.length > 0) {
            parts.push('### Entities from memory:');
            for (const entity of codeMemory.entities.slice(0, 10)) {
                const name = entity.name || entity.id || 'Unknown';
                const props = entity.properties || {};
                const details: string[] = [];
                
                if (props.status) details.push(`status: ${props.status}`);
                if (props.outcome) details.push(`outcome: ${props.outcome}`);
                if (props.path) details.push(`path: ${props.path}`);
                
                parts.push(`- ${name}${details.length > 0 ? ` (${details.join(', ')})` : ''}`);
            }
            parts.push('');
        }
        
        return parts.join('\n');
    }

    /**
     * Get structured context from Code Memory API
     */
    private async fetchCodeMemoryContextFromApi(
        query: string,
        userId: string,
        sessionId?: string
    ): Promise<CodeMemoryResponse | null> {
        try {
            // IMPORTANT: query is required for context - without it context will be empty
            // If query is empty, use a default query to retrieve all memory
            const effectiveQuery = query && query.trim().length > 0 
                ? query.trim() 
                : 'Get user memory context';
            
            const payload = {
                user_id: userId,
                query: effectiveQuery, // IMPORTANT: always pass query
                session_id: sessionId,
                limit: 40,
                include_graph: true,
                include_entities: true,
                include_memories: true,
                include_search_hits: true
            };

            const response = await this.client.post<CodeMemoryResponse>(
                '/api/v1/code-memory/context',
                payload
            );

            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            if (axiosError.response?.status === 404) {
                console.warn('[ODAM Client] Code memory endpoint not available (404). Falling back to chat endpoint.');
            } else {
                console.warn('[ODAM Client] Code memory endpoint error, fallback to chat:', {
                    message: axiosError.message,
                    status: axiosError.response?.status
                });
            }
            return null;
        }
    }

    /**
     * Update ODAM memory with a new message
     * IMPORTANT: Use /api/v1/code-memory/record instead of /api/v1/chat
     * record_interaction() internally calls process_chat() for automatic entity extraction
     */
    async updateMemory(
        message: string,
        userId: string,
        sessionId?: string,
        response?: string  // ✅ FIX: Add response parameter
    ): Promise<boolean> {
        try {
            // ✅ CORRECT: Use /api/v1/code-memory/record
            // record_interaction() internally calls process_chat() for automatic entity extraction
            const payload: CodeInteractionPayload = {
                user_id: userId,
                session_id: sessionId,
                query: message,
                response: response || '', // ✅ FIX: Use response if provided
                artifacts: [] // For simple messages artifacts can be empty
            };

            const apiResponse = await this.client.post<CodeMemoryRecordResponse>(
                '/api/v1/code-memory/record',
                payload
            );

            console.log('[ODAM Client] Memory updated via code-memory/record:', {
                success: apiResponse.data.success,
                stored_artifacts: apiResponse.data.stored_artifacts,
                memories_created: apiResponse.data.memories_created,
                hasResponse: !!response  // ✅ FIX: Log if response was provided
            });

            return apiResponse.data.success;
        } catch (error) {
            const axiosError = error as AxiosError;
            console.error('[ODAM Client] updateMemory error:', {
                message: axiosError.message,
                status: axiosError.response?.status,
                statusText: axiosError.response?.statusText
            });
            return false;
        }
    }

    /**
     * Record code artifact to ODAM memory
     * New method for saving code and interactions with Cursor
     */
    async recordCodeArtifact(
        payload: CodeInteractionPayload,
        workspaceFolder?: vscode.WorkspaceFolder
    ): Promise<CodeMemoryRecordResponse | null> {
        try {
            // ✅ FIX: Get output channel for current workspace to ensure logs appear in correct project
            const outputChannel = this.getOutputChannel(workspaceFolder);
            
            const fullUrl = `${this.apiUrl}/api/v1/code-memory/record`;
            const logMsg1 = `[ODAM Client] 📤 Recording code artifact to ODAM: full_url=${fullUrl}, user_id=${payload.user_id}, session_id=${payload.session_id}, query_length=${payload.query?.length || 0}, response_length=${payload.response?.length || 0}, artifacts_count=${payload.artifacts?.length || 0}, has_api_key=${!!this.apiKey}`;
            console.log(logMsg1);
            outputChannel.appendLine(`[${new Date().toISOString()}] ${logMsg1}`);
            
            // ✅ FIX: Log full query and response in output channel (not console to avoid clutter)
            outputChannel.appendLine(`[${new Date().toISOString()}] Query preview: ${payload.query?.substring(0, 100) || '(empty)'}...`);
            outputChannel.appendLine(`[${new Date().toISOString()}] Response preview: ${payload.response?.substring(0, 100) || '(empty)'}...`);
            
            // ✅ FIX: Log full query and response in output channel for debugging
            if (payload.query) {
                outputChannel.appendLine(`[${new Date().toISOString()}] Full query: ${payload.query}`);
            }
            if (payload.response) {
                outputChannel.appendLine(`[${new Date().toISOString()}] Full response: ${payload.response}`);
            }
            if (payload.artifacts && payload.artifacts.length > 0) {
                outputChannel.appendLine(`[${new Date().toISOString()}] Artifacts: ${JSON.stringify(payload.artifacts, null, 2)}`);
            }
            if (payload.metadata) {
                outputChannel.appendLine(`[${new Date().toISOString()}] Metadata: ${JSON.stringify(payload.metadata, null, 2)}`);
            }

            const response = await this.client.post<CodeMemoryRecordResponse>(
                '/api/v1/code-memory/record',
                payload
            );

            const successMsg = `[ODAM Client] ✅ ✅ ✅ Code artifact recorded successfully: success=${response.data.success}, stored_artifacts=${response.data.stored_artifacts}, memories_created=${response.data.memories_created}, status=${response.status}`;
            console.log(successMsg);
            outputChannel.appendLine(`[${new Date().toISOString()}] ${successMsg}`);
            outputChannel.appendLine(`[${new Date().toISOString()}] Memory stats: ${JSON.stringify(response.data.memory_stats)}`);

            return response.data;
        } catch (error) {
            const axiosError = error as AxiosError;
            const outputChannel = this.getOutputChannel(workspaceFolder);
            const errorMsg = `[ODAM Client] ❌ recordCodeArtifact error: message=${axiosError.message}, status=${axiosError.response?.status}, statusText=${axiosError.response?.statusText}, url=${axiosError.config?.url}, method=${axiosError.config?.method}`;
            console.error(errorMsg);
            outputChannel.appendLine(`[${new Date().toISOString()}] ${errorMsg}`);
            
            // Log full error details for debugging
            if (axiosError.response) {
                const errorData = JSON.stringify(axiosError.response.data, null, 2);
                console.error('[ODAM Client] Full error response:', errorData);
                outputChannel.appendLine(`[${new Date().toISOString()}] Full error response: ${errorData}`);
            }
            
            return null;
        }
    }

    /**
     * Get user memory statistics
     * ✅ FIX: Use /api/v1/code-memory/context to get statistics
     * @param userId - User identifier (global)
     * @param sessionId - Optional session/project identifier. If provided, returns project-specific stats. If not, returns global user stats.
     */
    async getMemoryStats(userId: string, sessionId?: string, retryCount: number = 0): Promise<MemoryStats | null> {
        try {
            // ✅ FIX: If sessionId is provided, get project-specific stats. Otherwise, get global stats.
            // This allows us to show both global and project-specific statistics
            // IMPORTANT: Use a broader query and higher limit to ensure we get accurate statistics
            // Statistics are calculated by ODAM based on session_id, not limited by query results
            const payload = {
                user_id: userId,
                ...(sessionId && { session_id: sessionId }),  // ✅ Include session_id if provided for project-specific stats
                query: sessionId ? 'Get all project memory statistics and context' : 'Get all user memory statistics',
                limit: 100,  // ✅ Increased limit to ensure we get comprehensive statistics (was 40)
                include_graph: true,  // ✅ Enable to get graph_nodes count
                include_entities: true,  // ✅ Enable to get entities_total count
                include_memories: true,  // ✅ Enable to get memories_total count
                include_search_hits: false  // Not needed for stats
            };

            console.log('[ODAM Client] Fetching memory stats:', { userId, sessionId, payload, retryCount });

            // ✅ FIX: ODAM API returns CodeMemoryResponse directly, not wrapped in MemoryContextResult
            // According to curl test: response structure is { stats: {...}, entities: [...], graph: {...}, ... }
            const response = await this.client.post<CodeMemoryResponse>('/api/v1/code-memory/context', payload);
            
            // ✅ FIX: Log full response structure to understand what ODAM API returns
            console.log('[ODAM Client] Memory stats response:', {
                hasData: !!response.data,
                hasStats: !!response.data?.stats,
                stats: response.data?.stats,
                statsKeys: response.data?.stats ? Object.keys(response.data.stats) : [],
                memoriesArray: response.data?.memories ? `Array(${response.data.memories.length})` : 'none',
                entitiesArray: response.data?.entities ? `Array(${response.data.entities.length})` : 'none',
                graphNodes: response.data?.graph?.nodes ? `Array(${response.data.graph.nodes.length})` : 'none',
                responseKeys: response.data ? Object.keys(response.data) : []
            });
            
            // ✅ FIX: ODAM API returns CodeMemoryResponse directly with stats at root level
            if (response.data && response.data.stats) {
                const stats = response.data.stats;
                
                // ✅ FIX: Use stats.memories_total directly from ODAM API
                // According to curl test: stats.memories_total contains the correct count
                // IMPORTANT: memories_total represents total memories for the session/project
                // memories_created in recordCodeArtifact response is per-request count (episodic + semantic)
                const totalMemories = stats.memories_total || 0;
                
                // ✅ FIX: Use actual statistics from ODAM API response
                // These are calculated by ODAM for the specific session_id (project)
                const result = {
                    user_id: userId,
                    total_memories: totalMemories,
                    entities_count: stats.entities_total || 0,
                    graph_nodes: stats.graph_nodes || 0,
                    memory_health_score: stats.entities_total > 0 ? Math.min(0.8 + (totalMemories || 0) * 0.05, 1.0) : 0.0,
                    last_updated: stats.generated_at || new Date().toISOString()
                } as MemoryStats;
                
                console.log('[ODAM Client] Parsed memory stats (project-specific):', {
                    sessionId,
                    result,
                    rawStats: stats,
                    note: 'memories_total is total memories for project, memories_created in recordCodeArtifact is per-request count'
                });
                return result;
            }
            
            // ✅ FIX: If stats not found and retryCount < 2, retry after delay (ODAM may need time to index)
            if (retryCount < 2) {
                console.log(`[ODAM Client] Stats not found, retrying after 1 second (attempt ${retryCount + 1}/2)...`);
                await new Promise(resolve => setTimeout(resolve, 1000));
                return this.getMemoryStats(userId, sessionId, retryCount + 1);
            }
            
            console.warn('[ODAM Client] No stats found in response:', {
                sessionId,
                responseData: response.data,
                responseKeys: response.data ? Object.keys(response.data) : []
            });
            return null;
        } catch (error) {
            const axiosError = error as AxiosError;
            console.error('[ODAM Client] getMemoryStats error:', {
                sessionId,
                message: axiosError.message,
                status: axiosError.response?.status,
                statusText: axiosError.response?.statusText,
                data: axiosError.response?.data
            });
            return null;
        }
    }

    /**
     * Check ODAM API availability
     */
    async healthCheck(): Promise<boolean> {
        try {
            const response = await this.client.get('/health');
            return response.status === 200;
        } catch (error) {
            return false;
        }
    }

    /**
     * Format memory context for insertion into prompt
     * IMPORTANT: Use only structured data (entities, graph), NOT AI text response
     */
    private formatMemoryContext(response: ChatResponse): string {
        const parts: string[] = [];
        
        // 1. Mention how many memories were found
        if (response.memories_found > 0) {
            parts.push(`Found ${response.memories_found} relevant memories in ODAM long-term storage.`);
        }

        // 2. Extracted entities (ALWAYS use, even if memories_found = 0)
        // ODAM extracts entities from current query and saves them to memory
        if (response.extracted_entities && response.extracted_entities.length > 0) {
            const entitiesContext = this.formatEntitiesAsContext(response.extracted_entities);
            if (entitiesContext) {
                parts.push(entitiesContext);
            }
        }

        // 3. Memory graph (relationships between entities)
        if (response.memory_graph && response.memory_graph.length > 0) {
            const graphContext = this.formatMemoryGraphAsContext(response.memory_graph);
            if (graphContext) {
                parts.push(graphContext);
            }
        }

        // 4. Do NOT use response (AI text response) - this is not memory!
        // For sidecar approach we need only structured data

        if (parts.length === 0) {
            // If no structured data, return empty context
            // This is normal for first use when memory is still empty
            return '';
        }

        return parts.join('\n');
    }

    /**
     * Format extracted entities as context
     * Entities contain structured information about user and project
     */
    private formatEntitiesAsContext(entities: any[]): string {
        if (!entities || entities.length === 0) {
            return '';
        }

        const parts: string[] = [];
        
        // Group entities by type for better understanding
        const entitiesByType: { [key: string]: any[] } = {};
        
        entities.slice(0, 15).forEach((e: any) => {
            const name = e.name || e.entity_name || '';
            const type = e.type || e.entity_type || 'Other';
            const properties = e.properties || {};
            const confidence = e.confidence || 0;
            
            if (!name || name === 'Unknown') {
                return; // Skip entities without name
            }
            
            if (!entitiesByType[type]) {
                entitiesByType[type] = [];
            }
            
            entitiesByType[type].push({
                name,
                properties,
                confidence
            });
        });

        // Format by types
        for (const [type, items] of Object.entries(entitiesByType)) {
            if (items.length === 0) continue;
            
            const entityNames = items.map((e: any) => {
                // Format entity description with properties if available
                let desc = e.name;
                if (e.properties && Object.keys(e.properties).length > 0) {
                    const props = Object.entries(e.properties)
                        .slice(0, 2) // Limit number of properties
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(', ');
                    if (props) {
                        desc += ` (${props})`;
                    }
                }
                return desc;
            }).join(', ');
            
            // Translate types to English for better AI understanding
            const typeLabel = this.translateEntityType(type);
            parts.push(`${typeLabel}: ${entityNames}`);
        }

        if (parts.length === 0) {
            return '';
        }

        return `Extracted entities from ODAM memory:\n${parts.join('\n')}`;
    }

    /**
     * Translate entity type to English for better AI understanding
     */
    private translateEntityType(type: string): string {
        const translations: { [key: string]: string } = {
            'Person': 'User',
            'Technology': 'Technology',
            'Project': 'Project',
            'Language': 'Programming language',
            'Tool': 'Tool',
            'Library': 'Library',
            'Framework': 'Framework',
            'Preference': 'Preference',
            'Error': 'Error',
            'Solution': 'Solution',
            'Approach': 'Approach',
            'Pattern': 'Pattern',
            'Style': 'Coding style'
        };
        
        return translations[type] || type;
    }

    /**
     * Format memory_graph as context
     * Graph contains relationships between entities in memory
     */
    private formatMemoryGraphAsContext(graph: any[]): string {
        if (!graph || graph.length === 0) {
            return '';
        }

        const connections: string[] = [];
        
        // Extract relationships from graph
        graph.slice(0, 10).forEach((item: any) => {
            // Graph can arrive in multiple formats
            if (item.relationship && item.source && item.target) {
                connections.push(`${item.source} → ${item.relationship} → ${item.target}`);
            } else if (item.from && item.to && item.type) {
                connections.push(`${item.from} → ${item.type} → ${item.to}`);
            } else if (item.entity1 && item.entity2 && item.relation) {
                connections.push(`${item.entity1} → ${item.relation} → ${item.entity2}`);
            }
        });

        if (connections.length === 0) {
            return '';
        }

        return `ODAM memory relationships:\n${connections.join('\n')}`;
    }

    /**
     * Create context from ODAM response for insertion into system prompt
     * More advanced formatting version
     */
    formatMemoryForPrompt(response: ChatResponse, userQuery: string): string {
        if (response.memories_found === 0) {
            return '';
        }

        const parts: string[] = [];
        
        // Add information about found memories
        if (response.memories_found > 0) {
            parts.push(`Found ${response.memories_found} relevant memories in long-term storage.`);
        }

        // Add extracted entities if available
        if (response.extracted_entities && response.extracted_entities.length > 0) {
            const entities = response.extracted_entities
                .slice(0, 5) // Limit quantity
                .map(e => e.name || e.type || JSON.stringify(e))
                .join(', ');
            if (entities) {
                parts.push(`Mentioned entities: ${entities}`);
            }
        }

        // Use ODAM response as context (it's already personalized)
        // But for sidecar it's better not to use the response itself, only facts
        // So we form context based on metadata
        
        if (parts.length === 0) {
            return '';
        }

        return `[ODAM MEMORY]:\n${parts.join('\n')}\n\nConsider this information when responding to the user.`;
    }
}



