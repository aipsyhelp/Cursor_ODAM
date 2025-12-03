/**
 * Memory Debugger
 * Tools for troubleshooting ODAM Memory behaviour
 */

import * as vscode from 'vscode';
import { OdamClient, ChatResponse, CodeMemoryResponse } from './odamClient';

export class MemoryDebugger {
    private client: OdamClient;
    private userId: string;
    private outputChannel: vscode.OutputChannel;

    constructor(client: OdamClient, userId: string, workspaceFolder?: vscode.WorkspaceFolder) {
        this.client = client;
        this.userId = userId;
        
        // ✅ FIX: Create workspace-specific output channel to prevent log mixing between projects
        const channelName = workspaceFolder 
            ? `ODAM Memory Debug (${require('path').basename(workspaceFolder.uri.fsPath)})`
            : 'ODAM Memory Debug';
        this.outputChannel = vscode.window.createOutputChannel(channelName);
    }

    /**
     * Print detailed information returned by ODAM
     */
    async debugODAMResponse(
        query: string,
        sessionId?: string
    ): Promise<void> {
        this.outputChannel.clear();
        this.outputChannel.show(true);
        
        this.outputChannel.appendLine('='.repeat(80));
        this.outputChannel.appendLine('🔍 ODAM Memory Debug – Detailed analysis');
        this.outputChannel.appendLine('='.repeat(80));
        this.outputChannel.appendLine('');

        // Request info
        this.outputChannel.appendLine('📤 REQUEST TO ODAM:');
        this.outputChannel.appendLine(`   Query: ${query}`);
        this.outputChannel.appendLine(`   User ID: ${this.userId}`);
        this.outputChannel.appendLine(`   Session ID: ${sessionId || 'not provided'}`);
        this.outputChannel.appendLine('');

        try {
            const result = await this.client.fetchMemoryContext(query, this.userId, sessionId);
            
            // Response summary
            this.outputChannel.appendLine('📥 RESPONSE FROM ODAM:');
            this.outputChannel.appendLine(`   Memories Found: ${result.memoriesFound}`);
            this.outputChannel.appendLine(`   Has Context: ${!!result.context}`);
            this.outputChannel.appendLine(`   Context Length: ${result.context?.length || 0} chars`);
            this.outputChannel.appendLine('');

            if (result.response) {
                // Detailed metrics
                this.outputChannel.appendLine('📊 DETAILED ODAM METRICS:');
                this.outputChannel.appendLine(`   Response Text: ${result.response.response?.substring(0, 200)}...`);
                this.outputChannel.appendLine(`   Memories Found: ${result.response.memories_found || 0}`);
                this.outputChannel.appendLine(`   Memories Created: ${result.response.memories_created || 0}`);
                this.outputChannel.appendLine(`   Entities Extracted: ${result.response.entities_extracted || 0}`);
                this.outputChannel.appendLine(`   Personalization Score: ${(result.response.personalization_score || 0).toFixed(2)}`);
                this.outputChannel.appendLine(`   Processing Time: ${result.response.processing_time_ms || 0}ms`);
                this.outputChannel.appendLine('');

                // Extracted entities
                if (result.response.extracted_entities && result.response.extracted_entities.length > 0) {
                    this.outputChannel.appendLine('🏷️  EXTRACTED ENTITIES:');
                    result.response.extracted_entities.forEach((entity: any, index: number) => {
                        this.outputChannel.appendLine(`   ${index + 1}. ${entity.name || 'Unknown'} (${entity.type || 'Unknown'})`);
                        if (entity.properties && Object.keys(entity.properties).length > 0) {
                            this.outputChannel.appendLine(`      Properties: ${JSON.stringify(entity.properties)}`);
                        }
                        if (entity.confidence) {
                            this.outputChannel.appendLine(`      Confidence: ${(entity.confidence * 100).toFixed(1)}%`);
                        }
                    });
                    this.outputChannel.appendLine('');
                } else {
                    this.outputChannel.appendLine('⚠️  EXTRACTED ENTITIES: None');
                    this.outputChannel.appendLine('');
                }

                // Memory graph
                if (result.response.memory_graph && result.response.memory_graph.length > 0) {
                    this.outputChannel.appendLine('🔗 MEMORY GRAPH:');
                    result.response.memory_graph.forEach((item: any, index: number) => {
                        if (item.source && item.relationship && item.target) {
                            this.outputChannel.appendLine(`   ${index + 1}. ${item.source} → ${item.relationship} → ${item.target}`);
                        } else {
                            this.outputChannel.appendLine(`   ${index + 1}. ${JSON.stringify(item)}`);
                        }
                    });
                    this.outputChannel.appendLine('');
                } else {
                    this.outputChannel.appendLine('⚠️  MEMORY GRAPH: Empty');
                    this.outputChannel.appendLine('');
                }

                // Search metrics
                if (result.response.search_metrics) {
                    this.outputChannel.appendLine('🔍 SEARCH METRICS:');
                    this.outputChannel.appendLine(`   Total Time: ${result.response.search_metrics.total_time_ms || 0}ms`);
                    this.outputChannel.appendLine(`   Vector Time: ${result.response.search_metrics.vector_time_ms || 0}ms`);
                    this.outputChannel.appendLine(`   Graph Time: ${result.response.search_metrics.graph_time_ms || 0}ms`);
                    this.outputChannel.appendLine(`   Cache Hits: ${result.response.search_metrics.cache_hits || 0}`);
                    this.outputChannel.appendLine('');
                }
            }

            // Code Memory summary
            this.printCodeMemorySummary(result.codeMemory);

            // Final context
            this.outputChannel.appendLine('📝 CONTEXT BUILT FOR AI:');
            if (result.context) {
                this.outputChannel.appendLine(result.context);
            } else {
                this.outputChannel.appendLine('   (empty – no data returned)');
            }
            this.outputChannel.appendLine('');

            // Full JSON response
            this.outputChannel.appendLine('📋 FULL ODAM JSON RESPONSE:');
            this.outputChannel.appendLine(JSON.stringify(result.response, null, 2));
            this.outputChannel.appendLine('');

            this.outputChannel.appendLine('='.repeat(80));
            this.outputChannel.appendLine('✅ Analysis completed');
            this.outputChannel.appendLine('='.repeat(80));

        } catch (error: any) {
            this.outputChannel.appendLine('❌ ERROR:');
            this.outputChannel.appendLine(`   ${error.message}`);
            if (error.response) {
                this.outputChannel.appendLine(`   Status: ${error.response.status}`);
                this.outputChannel.appendLine(`   Data: ${JSON.stringify(error.response.data)}`);
            }
            this.outputChannel.appendLine('');
        }
    }

    /**
     * Display the current `.mdc` file content
     */
    showCurrentMemoryContext(workspaceFolder?: vscode.WorkspaceFolder): void {
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder first');
            return;
        }

        const path = require('path');
        const fs = require('fs');
        const memoryFilePath = path.join(
            workspaceFolder.uri.fsPath,
            '.cursor',
            'rules',
            'odam-memory.mdc'
        );

        this.outputChannel.clear();
        this.outputChannel.show(true);

        this.outputChannel.appendLine('='.repeat(80));
        this.outputChannel.appendLine('📄 CURRENT ODAM MEMORY FILE');
        this.outputChannel.appendLine('='.repeat(80));
        this.outputChannel.appendLine('');

        if (fs.existsSync(memoryFilePath)) {
            const content = fs.readFileSync(memoryFilePath, 'utf8');
            this.outputChannel.appendLine('File: ' + memoryFilePath);
            this.outputChannel.appendLine('');
            this.outputChannel.appendLine('Content:');
            this.outputChannel.appendLine('-'.repeat(80));
            this.outputChannel.appendLine(content);
            this.outputChannel.appendLine('-'.repeat(80));
        } else {
            this.outputChannel.appendLine('⚠️  Memory file not found:');
            this.outputChannel.appendLine(memoryFilePath);
            this.outputChannel.appendLine('');
            this.outputChannel.appendLine('This is normal if memory has never been updated.');
        }

        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('='.repeat(80));
    }

    /**
     * Compare the submitted query with ODAM’s response
     */
    async compareRequestResponse(
        query: string,
        sessionId?: string
    ): Promise<void> {
        this.outputChannel.clear();
        this.outputChannel.show(true);

        this.outputChannel.appendLine('='.repeat(80));
        this.outputChannel.appendLine('⚖️  COMPARISON: Query → Response');
        this.outputChannel.appendLine('='.repeat(80));
        this.outputChannel.appendLine('');

        // Submitted query
        this.outputChannel.appendLine('📤 SENT QUERY:');
        this.outputChannel.appendLine(`   "${query}"`);
        this.outputChannel.appendLine('');

        try {
            const result = await this.client.fetchMemoryContext(query, this.userId, sessionId);

            // Response summary
            this.outputChannel.appendLine('📥 RECEIVED:');
            this.outputChannel.appendLine(`   Memories Found: ${result.memoriesFound}`);
            this.outputChannel.appendLine(`   Entities Extracted: ${result.response?.entities_extracted || 0}`);
            this.outputChannel.appendLine('');

            // Entities
            if (result.response?.extracted_entities && result.response.extracted_entities.length > 0) {
                this.outputChannel.appendLine('✅ ODAM EXTRACTED ENTITIES:');
                result.response.extracted_entities.forEach((e: any) => {
                    this.outputChannel.appendLine(`   - ${e.name} (${e.type})`);
                });
            } else {
                this.outputChannel.appendLine('⚠️  ODAM DID NOT EXTRACT ENTITIES');
            }
            this.outputChannel.appendLine('');

            // Context delivered to AI
            this.outputChannel.appendLine('📝 CONTEXT FOR AI:');
            if (result.context) {
                this.outputChannel.appendLine(result.context);
            } else {
                this.outputChannel.appendLine('   (empty)');
            }
            this.outputChannel.appendLine('');

            this.printCodeMemorySummary(result.codeMemory);

            // Analysis
            this.outputChannel.appendLine('🔍 ANALYSIS:');
            if (result.memoriesFound > 0) {
                this.outputChannel.appendLine('   ✅ Relevant memories were found in ODAM');
            } else {
                this.outputChannel.appendLine('   ⚠️  Memory is empty or no relevant facts were found');
            }

            if (result.response?.extracted_entities && result.response.extracted_entities.length > 0) {
                this.outputChannel.appendLine('   ✅ Entities were extracted from this query');
                this.outputChannel.appendLine('   ✅ These entities were saved to ODAM memory');
            } else {
                this.outputChannel.appendLine('   ⚠️  No entities extracted (the query might be too generic)');
            }

            if (result.context) {
                this.outputChannel.appendLine('   ✅ Context was built and will be injected into AI');
            } else {
                this.outputChannel.appendLine('   ⚠️  Context is empty (AI will not receive ODAM memory)');
            }

        } catch (error: any) {
            this.outputChannel.appendLine('❌ ERROR:');
            this.outputChannel.appendLine(`   ${error.message}`);
        }

        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('='.repeat(80));
    }

    /**
     * Analyse how ODAM memory is used inside the active chat
     */
    async analyzeMemoryUsageInChat(
        userQuery: string,
        sessionId?: string
    ): Promise<void> {
        this.outputChannel.clear();
        this.outputChannel.show(true);

        this.outputChannel.appendLine('='.repeat(80));
        this.outputChannel.appendLine('💬 ODAM memory usage analysis');
        this.outputChannel.appendLine('='.repeat(80));
        this.outputChannel.appendLine('');

        // Fetch memory context for this query
        const result = await this.client.fetchMemoryContext(userQuery, this.userId, sessionId);

        this.outputChannel.appendLine('📝 USER QUERY:');
        this.outputChannel.appendLine(`   "${userQuery}"`);
        this.outputChannel.appendLine('');

        this.outputChannel.appendLine('🧠 MEMORY CONTEXT FOR AI:');
        if (result.context) {
            this.outputChannel.appendLine(result.context);
        } else {
            this.outputChannel.appendLine('   (empty – memory was not used)');
        }
        this.outputChannel.appendLine('');

        this.printCodeMemorySummary(result.codeMemory);

        // Analysis
        this.outputChannel.appendLine('🔍 ANALYSIS:');
        
        if (result.memoriesFound > 0) {
            this.outputChannel.appendLine('   ✅ Relevant memories were returned');
            this.outputChannel.appendLine(`   ✅ AI received ${result.memoriesFound} memories from long-term storage`);
        } else {
            this.outputChannel.appendLine('   ⚠️  No relevant memories were found');
        }

        if (result.response?.extracted_entities && result.response.extracted_entities.length > 0) {
            this.outputChannel.appendLine(`   ✅ ${result.response.extracted_entities.length} entities extracted and saved to ODAM`);
        }

        if (result.context) {
            this.outputChannel.appendLine('   ✅ Memory context was injected into the system prompt');
            this.outputChannel.appendLine('   ✅ AI should consider these facts in its response');
        } else {
            this.outputChannel.appendLine('   ⚠️  Memory context is empty');
            this.outputChannel.appendLine('   ⚠️  AI did not receive ODAM information');
        }

        this.outputChannel.appendLine('');

        // Recommendations
        this.outputChannel.appendLine('💡 RECOMMENDATIONS:');
        
        if (!result.context) {
            this.outputChannel.appendLine('   1. Update ODAM memory before asking a question:');
            this.outputChannel.appendLine('      Cmd + Shift + P → "ODAM: Update Memory for Query"');
            this.outputChannel.appendLine('   2. Ensure ODAM API is reachable and configured');
            this.outputChannel.appendLine('   3. Make sure the project has indexed documentation or prior chats');
        } else {
            this.outputChannel.appendLine('   ✅ Memory pipeline works as expected');
            this.outputChannel.appendLine('   ✅ AI received ODAM context');
            this.outputChannel.appendLine('   ✅ Review the AI answer to verify it reflects the stored facts');
        }

        this.outputChannel.appendLine('');
        this.outputChannel.appendLine('='.repeat(80));
    }

    /**
     * Print a short summary of Code Memory data
     */
    private printCodeMemorySummary(codeMemory?: CodeMemoryResponse): void {
        if (!codeMemory) {
            return;
        }

        this.outputChannel.appendLine('🧠 Code Memory (API summary):');
        if (codeMemory.stats) {
            this.outputChannel.appendLine(`   Entities: ${codeMemory.stats.entities_total}`);
            this.outputChannel.appendLine(`   Memories: ${codeMemory.stats.memories_total}`);
            this.outputChannel.appendLine(`   Graph nodes: ${codeMemory.stats.graph_nodes}`);
            this.outputChannel.appendLine(`   Generated: ${codeMemory.stats.generated_at}`);
        }

        if (codeMemory.sections && codeMemory.sections.length > 0) {
            this.outputChannel.appendLine('   Sections:');
            codeMemory.sections.slice(0, 3).forEach((section, idx) => {
                this.outputChannel.appendLine(`   ${idx + 1}. ${section.title}`);
                section.items.slice(0, 3).forEach(item => {
                    this.outputChannel.appendLine(`      • ${item.label}: ${item.values.join(', ')}`);
                });
            });
        }

        this.outputChannel.appendLine('');
    }

    dispose(): void {
        this.outputChannel.dispose();
    }
}

