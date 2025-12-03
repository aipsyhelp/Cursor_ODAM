/**
 * ODAM Memory Extension for Cursor IDE
 * Main extension entry point
 */

import * as vscode from 'vscode';
import { OdamClient, ChatResponse, MemoryStats } from './odamClient';
import { MemoryContextProvider } from './memoryContextProvider';
import { MemoryStatusBar } from './memoryStatusBar';
import { MemoryFileUpdater } from './memoryFileUpdater';
import { MemoryDebugger } from './memoryDebugger';
import { CodeArtifactTracker } from './codeArtifactTracker';
import { CodeStyleTracker } from './codeStyleTracker';
import { ContextLogger } from './contextLogger';
import { HookEventProcessor } from './hookEventProcessor';
import { HookEventServer } from './hookEventServer';
import { setupHookEnvironment } from './hookInstaller';
import { ProjectKnowledgeIndexer } from './projectKnowledgeIndexer';

let odamClient: OdamClient | null = null;
let contextProvider: MemoryContextProvider | null = null;
let statusBar: MemoryStatusBar | null = null;
let memoryFileUpdater: MemoryFileUpdater | null = null;
let memoryDebugger: MemoryDebugger | null = null;
let codeArtifactTracker: CodeArtifactTracker | null = null;
let codeStyleTracker: CodeStyleTracker | null = null;
let contextLogger: ContextLogger | null = null;
let hookEventProcessor: HookEventProcessor | null = null;
let hookEventServer: HookEventServer | null = null;
let projectIndexer: ProjectKnowledgeIndexer | null = null;

/**
 * Activate the extension
 */
export async function activate(context: vscode.ExtensionContext) {
    // Get workspace folder for workspace-specific output channels
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    
    // Create activation output channel (workspace-specific)
    const channelName = workspaceFolder 
        ? `ODAM Extension (${require('path').basename(workspaceFolder.uri.fsPath)})`
        : 'ODAM Extension';
    const outputChannel = vscode.window.createOutputChannel(channelName);
    outputChannel.show(true); // auto-show for visibility
    outputChannel.appendLine('═══════════════════════════════════════════════════════════');
    outputChannel.appendLine('ODAM Memory Extension is activating...');
    outputChannel.appendLine(`[${new Date().toISOString()}] Starting activation`);
    
    console.log('ODAM Memory Extension is activating...');

    // Load configuration
    const config = vscode.workspace.getConfiguration('odam');
    const enabled = config.get<boolean>('enabled', false);
    const apiUrl = config.get<string>('apiUrl', 'https://api.odam.dev');
    const apiKey = config.get<string>('apiKey', '');
    const chatFallbackEnabled = config.get<boolean>('chatFallbackEnabled', false);
    const debugChatProbeEnabled = config.get<boolean>('debugChatProbe', false);
    
    outputChannel.appendLine(`Configuration:`);
    outputChannel.appendLine(`  Enabled: ${enabled}`);
    outputChannel.appendLine(`  API URL: ${apiUrl}`);
    outputChannel.appendLine(`  API Key: ${apiKey ? '***' + apiKey.slice(-4) : '(not set)'}`);
    
    if (!enabled || !apiKey) {
        const msg = 'ODAM is disabled or not configured';
        console.log(msg);
        outputChannel.appendLine(`⚠️ ${msg}`);
        outputChannel.appendLine('═══════════════════════════════════════════════════════════');
        return;
    }

    // Initialize ODAM client with workspace folder for workspace-specific output channels
    odamClient = new OdamClient(apiUrl, apiKey, {
        chatFallbackEnabled
    }, workspaceFolder);

    // Ensure ODAM API is reachable
    const isHealthy = await odamClient.healthCheck();
    if (!isHealthy) {
        vscode.window.showWarningMessage(
            'ODAM API is unreachable. Check settings and network connectivity.'
        );
        return;
    }

    // Read or create user_id
    let userId = config.get<string>('userId', '');
    if (!userId) {
        // Generate unique ID from system username
        userId = generateUserId();
        await config.update('userId', userId, vscode.ConfigurationTarget.Global);
    }

    // Initialize context logger
    if (workspaceFolder) {
        contextLogger = new ContextLogger(workspaceFolder);
    }

    // Initialize components
    codeArtifactTracker = new CodeArtifactTracker(odamClient, userId, context, contextLogger || undefined);
    contextProvider = new MemoryContextProvider(odamClient, userId, codeArtifactTracker);
    statusBar = new MemoryStatusBar(context);
    memoryFileUpdater = new MemoryFileUpdater(odamClient, userId, contextLogger || undefined, workspaceFolder);
    memoryDebugger = new MemoryDebugger(odamClient, userId, workspaceFolder);
    codeStyleTracker = new CodeStyleTracker(odamClient, userId);
    hookEventProcessor = new HookEventProcessor({
        memoryFileUpdater,
        odamClient,
        logger: contextLogger || undefined,
        workspaceProvider: () => vscode.workspace.workspaceFolders?.[0],
        statusBar: statusBar,
        userId: userId
    });
    const hookEnv = setupHookEnvironment(context.extensionPath);
    hookEventServer = new HookEventServer(hookEventProcessor, context);
    await hookEventServer.start();
    const hookServerMsg = `[Extension] Hook event server listening (hooks at ${hookEnv.hooksConfigPath})`;
    console.log(hookServerMsg);
    outputChannel.appendLine(hookServerMsg);

    // Register commands
    registerCommands(context, odamClient, userId, memoryFileUpdater, memoryDebugger, contextLogger || undefined);

    // Subscribe to workspace events
    setupEventListeners(context, odamClient, userId, memoryFileUpdater, codeArtifactTracker, codeStyleTracker);

    // Index project documentation to bootstrap ODAM memory (async, non-blocking)
    // IMPORTANT: Run indexing in background to avoid blocking activation and hook events
    if (workspaceFolder) {
        projectIndexer = new ProjectKnowledgeIndexer(odamClient, userId, context.globalState, contextLogger || undefined);
        // Run indexing asynchronously without blocking activation
        projectIndexer.indexWorkspace(workspaceFolder).catch((error) => {
            console.warn('[Extension] Project documentation indexing failed:', error);
            outputChannel.appendLine(`[${new Date().toISOString()}] ⚠️ Project indexing error: ${error instanceof Error ? error.message : String(error)}`);
        });
    }

    // Start chat interceptors
    if (debugChatProbeEnabled) {
        vscode.window.showInformationMessage('ODAM debugChatProbe enabled, but internal interceptors are disabled. Use the hooks pipeline instead.');
    }

    vscode.window.showInformationMessage('ODAM Memory activated!');
    const finalMsg = 'ODAM Memory Extension activated successfully';
    console.log(finalMsg);
    outputChannel.appendLine('═══════════════════════════════════════════════════════════');
    outputChannel.appendLine(`✅ ${finalMsg}`);
    outputChannel.appendLine('Chat interception logs are available in the Output panel.');
    outputChannel.appendLine('Channel: "ODAM Hook Events"');
    outputChannel.appendLine('═══════════════════════════════════════════════════════════');
}

/**
 * Deactivate the extension
 */
export function deactivate() {
    if (statusBar) {
        statusBar.dispose();
    }
    if (memoryFileUpdater) {
        memoryFileUpdater.dispose();
    }
    if (memoryDebugger) {
        memoryDebugger.dispose();
    }
    if (codeArtifactTracker) {
        codeArtifactTracker.dispose();
    }
    if (hookEventServer) {
        hookEventServer.dispose();
    }
    if (hookEventProcessor) {
        hookEventProcessor.dispose();
        hookEventProcessor = null;
    }
    console.log('ODAM Memory Extension deactivated');
}

/**
 * Register extension commands
 */
function registerCommands(
    context: vscode.ExtensionContext,
    client: OdamClient,
    userId: string,
    fileUpdater: MemoryFileUpdater,
    memoryDebugger: MemoryDebugger,
    contextLogger?: ContextLogger
) {
    const extensionPath = context.extensionPath;
    // Configuration command
    const configureCommand = vscode.commands.registerCommand('odam.configure', async () => {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'odam');
    });

    // Show memory command
    const showMemoryCommand = vscode.commands.registerCommand('odam.showMemory', async () => {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            let stats: MemoryStats | null = null;
            let statsType = 'global';
            
            if (workspaceFolder) {
                // ✅ FIX: Get project-specific statistics (with session_id) for current project
                const sessionId = getSessionId(workspaceFolder.uri.fsPath);
                stats = await client.getMemoryStats(userId, sessionId);
                statsType = 'project';
            } else {
                // Fallback to global stats if no workspace
                stats = await client.getMemoryStats(userId);
            }
            
            if (stats) {
                const projectInfo = workspaceFolder ? `\nProject: ${require('path').basename(workspaceFolder.uri.fsPath)}` : '';
                const message = `ODAM Memory (${statsType}):${projectInfo}\n` +
                    `Total memories: ${stats.total_memories}\n` +
                    `Entities: ${stats.entities_count}\n` +
                    `Graph nodes: ${stats.graph_nodes || 0}\n` +
                    `Memory health: ${(stats.memory_health_score * 100).toFixed(1)}%`;
                vscode.window.showInformationMessage(message);
                
                // ✅ FIX: Update status bar tooltip with project-specific statistics
                if (statusBar) {
                    statusBar.updateTooltip(stats);
                }
            } else {
                vscode.window.showWarningMessage('Unable to fetch memory stats. Check ODAM API connectivity.');
                if (statusBar) {
                    statusBar.updateTooltip(null);
                }
            }
        } catch (error) {
            console.error('[Extension] Error getting memory stats:', error);
            vscode.window.showErrorMessage(`Failed to fetch stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
            if (statusBar) {
                statusBar.updateTooltip(null);
            }
        }
    });

    // Reset memory command
    const resetMemoryCommand = vscode.commands.registerCommand('odam.resetMemory', async () => {
        const confirm = await vscode.window.showWarningMessage(
            'Are you sure you want to reset memory for this project?',
            { modal: true },
            'Yes, reset'
        );

        if (confirm === 'Yes, reset') {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            const sessionId = workspaceFolder ? getSessionId(workspaceFolder.uri.fsPath) : undefined;
            
            // Send reset command to ODAM
            await client.updateMemory('/reset_memory', userId, sessionId);
            vscode.window.showInformationMessage('Project memory has been reset');
        }
    });

    // Toggle command
    const toggleCommand = vscode.commands.registerCommand('odam.toggle', async () => {
        const config = vscode.workspace.getConfiguration('odam');
        const current = config.get<boolean>('enabled', false);
        await config.update('enabled', !current, vscode.ConfigurationTarget.Global);
        vscode.window.showInformationMessage(
            `ODAM Memory ${!current ? 'enabled' : 'disabled'}`
        );
    });

    // Update memory for current query command
    const updateMemoryCommand = vscode.commands.registerCommand('odam.updateMemoryForQuery', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder to use ODAM Memory');
            return;
        }

        // Ask the user which query should refresh memory context
        const query = await vscode.window.showInputBox({
            prompt: 'Enter a query to refresh ODAM memory context',
            placeHolder: 'Example: How do we implement caching in this project?'
        });

        if (query) {
            if (statusBar) {
                statusBar.showActivity();
            }

            await fileUpdater.updateMemoryFile(query, workspaceFolder);
            
            if (statusBar) {
                statusBar.hideActivity();
            }

            vscode.window.showInformationMessage('Memory context updated! Now ask the AI.');
        }
    });

    // Debug ODAM response command
    const debugODAMCommand = vscode.commands.registerCommand('odam.debugODAM', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder');
            return;
        }

        const query = await vscode.window.showInputBox({
            prompt: 'Enter a query to debug ODAM',
            placeHolder: 'Example: I am using TypeScript'
        });

        if (query) {
            const sessionId = getSessionId(workspaceFolder.uri.fsPath);
            await memoryDebugger.debugODAMResponse(query, sessionId);
            vscode.window.showInformationMessage('Detailed ODAM response analysis opened in the Output panel');
        }
    });

    // Show current memory context command
    const showMemoryContextCommand = vscode.commands.registerCommand('odam.showMemoryContext', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder');
            return;
        }

        memoryDebugger.showCurrentMemoryContext(workspaceFolder);
        vscode.window.showInformationMessage('Current memory context opened in the Output panel');
    });

    // Compare request/response command
    const compareRequestResponseCommand = vscode.commands.registerCommand('odam.compareRequestResponse', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder');
            return;
        }

        const query = await vscode.window.showInputBox({
            prompt: 'Enter a query to compare',
            placeHolder: 'Example: I am using TypeScript'
        });

        if (query) {
            const sessionId = getSessionId(workspaceFolder.uri.fsPath);
            await memoryDebugger.compareRequestResponse(query, sessionId);
            vscode.window.showInformationMessage('Request/response comparison opened in the Output panel');
        }
    });

    // Analyze memory usage in chat command
    const analyzeMemoryUsageCommand = vscode.commands.registerCommand('odam.analyzeMemoryUsage', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder');
            return;
        }

        const query = await vscode.window.showInputBox({
            prompt: 'Enter your chat query to analyze memory usage',
            placeHolder: 'Example: How do we implement caching?'
        });

        if (query) {
            const sessionId = getSessionId(workspaceFolder.uri.fsPath);
            await memoryDebugger.analyzeMemoryUsageInChat(query, sessionId);
            vscode.window.showInformationMessage('Memory usage analysis opened in the Output panel');
        }
    });

    // Record artifacts from current file command
    const recordArtifactsCommand = vscode.commands.registerCommand('odam.recordArtifacts', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        const activeEditor = vscode.window.activeTextEditor;
        
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder');
            return;
        }

        if (!activeEditor || !activeEditor.document) {
            vscode.window.showWarningMessage('Open a code file');
            return;
        }

        const document = activeEditor.document;
        if (document.languageId === 'markdown' || document.languageId === 'plaintext') {
            vscode.window.showWarningMessage('Select a code file (not markdown or plaintext)');
            return;
        }

        // Ask user for the related query/response
        const userQuery = await vscode.window.showInputBox({
            prompt: 'Enter your query for the AI',
            placeHolder: 'Example: Creating a caching function'
        });

        if (!userQuery) {
            return;
        }

        const assistantResponse = await vscode.window.showInputBox({
            prompt: 'Enter the assistant response (or leave blank)',
            placeHolder: 'Example: Function cache_data() implemented'
        }) || 'Code generated';

        if (!memoryFileUpdater) {
            vscode.window.showWarningMessage('ODAM Memory is not initialized');
            return;
        }

        try {
            // Extract artifacts from the file
            const artifacts = await memoryFileUpdater.extractArtifactsFromResponse(
                document.getText(),
                workspaceFolder
            );

            if (artifacts.length === 0) {
                vscode.window.showWarningMessage('Failed to extract artifacts. Ensure the file contains functions or classes.');
                return;
            }

            // Recording artifacts
            const success = await memoryFileUpdater.recordCodeArtifact(
                userQuery,
                assistantResponse,
                artifacts,
                workspaceFolder
            );

            if (success) {
                vscode.window.showInformationMessage(
                    `✅ Stored ${artifacts.length} artifacts in ODAM memory`
                );
            } else {
                vscode.window.showWarningMessage('Failed to record artifacts. Check the logs.');
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Error while recording artifacts: ${error.message}`);
        }
    });

    // View context logs command
    const viewContextLogsCommand = vscode.commands.registerCommand('odam.viewContextLogs', async () => {
        if (!contextLogger) {
            vscode.window.showWarningMessage('Context Logger is not initialized');
            return;
        }

        contextLogger.showOutputChannel();
        
        const entries = contextLogger.getRecentEntries(50);
        if (entries.length === 0) {
            vscode.window.showInformationMessage('Logs are empty. Run a few Cursor chat requests.');
        } else {
            vscode.window.showInformationMessage(`Showing ${entries.length} recent log entries`);
        }
    });

    // View stored ODAM data command
    const viewOdamDataCommand = vscode.commands.registerCommand('odam.viewOdamData', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder');
            return;
        }

        const query = await vscode.window.showInputBox({
            prompt: 'Enter a query to inspect ODAM data',
            placeHolder: 'Example: processData or TypeScript'
        });

        if (!query) {
            return;
        }

        const config = vscode.workspace.getConfiguration('odam');
        const apiUrl = config.get<string>('apiUrl', 'https://api.odam.dev');
        const apiKey = config.get<string>('apiKey', '');
        const sessionId = getSessionId(workspaceFolder.uri.fsPath);

        const outputChannel = vscode.window.createOutputChannel('ODAM Saved Data Viewer');
        outputChannel.clear();
        outputChannel.show(true);

        outputChannel.appendLine('🔍 Searching ODAM data...');
        outputChannel.appendLine(`Query: ${query}`);
        outputChannel.appendLine(`User ID: ${userId}`);
        outputChannel.appendLine(`Session ID: ${sessionId}`);
        outputChannel.appendLine('');

        try {
        // Fetch context from ODAM
            if (!odamClient) {
                vscode.window.showErrorMessage('ODAM Client is not initialized');
                return;
            }
            const result = await odamClient.fetchMemoryContext(query, userId, sessionId);
            
            outputChannel.appendLine('═══════════════════════════════════════════════════════════');
            outputChannel.appendLine('📊 DATA FROM ODAM');
            outputChannel.appendLine('═══════════════════════════════════════════════════════════');
            outputChannel.appendLine('');

            if (result.codeMemory) {
                const cm = result.codeMemory;
                outputChannel.appendLine(`Stats:`);
                outputChannel.appendLine(`  - Entities: ${cm.stats?.entities_total || 0}`);
                outputChannel.appendLine(`  - Memories: ${cm.stats?.memories_total || 0}`);
                outputChannel.appendLine(`  - Graph nodes: ${cm.stats?.graph_nodes || 0}`);
                outputChannel.appendLine('');

                if (cm.sections && cm.sections.length > 0) {
                    outputChannel.appendLine('📋 Sections:');
                    cm.sections.forEach((section, idx) => {
                        outputChannel.appendLine(`  ${idx + 1}. ${section.title}`);
                        section.items.forEach(item => {
                            outputChannel.appendLine(`     - ${item.label}: ${item.values.join(', ')}`);
                        });
                    });
                    outputChannel.appendLine('');
                }

                if (cm.entities && cm.entities.length > 0) {
                    outputChannel.appendLine('🔗 Entities:');
                    cm.entities.slice(0, 20).forEach((entity, idx) => {
                        outputChannel.appendLine(`  ${idx + 1}. ${entity.name || entity.id} (${entity.type})`);
                        if (entity.properties && Object.keys(entity.properties).length > 0) {
                            outputChannel.appendLine(`     Properties: ${JSON.stringify(entity.properties)}`);
                        }
                    });
                    outputChannel.appendLine('');
                }

                if (cm.graph?.nodes && cm.graph.nodes.length > 0) {
                    outputChannel.appendLine('🕸️  Graph nodes:');
                    cm.graph.nodes.slice(0, 20).forEach((node, idx) => {
                        outputChannel.appendLine(`  ${idx + 1}. ${node.name} (${node.type})`);
                    });
                    outputChannel.appendLine('');
                }
            }

            if (result.context) {
                outputChannel.appendLine('📝 Text context:');
                outputChannel.appendLine(result.context);
                outputChannel.appendLine('');
            }

            outputChannel.appendLine('═══════════════════════════════════════════════════════════');
        } catch (error: any) {
            outputChannel.appendLine(`❌ Error: ${error.message}`);
        }
    });

    // Automatic extension check command
    const checkExtensionCommand = vscode.commands.registerCommand('odam.checkExtension', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder');
            return;
        }

        const outputChannel = vscode.window.createOutputChannel('ODAM Extension Check');
        outputChannel.clear();
        outputChannel.show(true);

        outputChannel.appendLine('🔍 Running automatic ODAM Memory Extension check...');
        outputChannel.appendLine('');

        try {
            const path = require('path');
            const { spawn } = require('child_process');
            const fs = require('fs');

            // Resolve script path
            const scriptPath = path.join(extensionPath, 'scripts', 'check-extension.js');
            const workspacePath = workspaceFolder.uri.fsPath;

            // Ensure script exists
            if (!fs.existsSync(scriptPath)) {
                throw new Error(`Script not found: ${scriptPath}`);
            }

            // Pass config via environment variables
            const config = vscode.workspace.getConfiguration('odam');
            const apiUrl = config.get<string>('apiUrl', '');
            const apiKey = config.get<string>('apiKey', '');

            const env = {
                ...process.env,
                ODAM_API_URL: apiUrl,
                ODAM_API_KEY: apiKey
            };

            outputChannel.appendLine(`Working directory: ${workspacePath}`);
            outputChannel.appendLine(`Script: ${scriptPath}`);
            outputChannel.appendLine('');

            // Use spawn instead of exec for compatibility
            return new Promise<void>((resolve, reject) => {
                const nodePath = process.execPath;
                const child = spawn(nodePath, [scriptPath, workspacePath], {
                    env: env,
                    cwd: path.dirname(scriptPath),
                    shell: false
                });

                let stdout = '';
                let stderr = '';

                child.stdout.on('data', (data: Buffer) => {
                    const text = data.toString();
                    stdout += text;
                    outputChannel.append(text);
                });

                child.stderr.on('data', (data: Buffer) => {
                    const text = data.toString();
                    stderr += text;
                    outputChannel.append(text);
                });

                child.on('close', (code: number) => {
                    if (code === 0) {
                        outputChannel.appendLine('');
                        outputChannel.appendLine('✅ Verification completed!');
                        outputChannel.appendLine(`📄 Report saved to: ${path.join(workspacePath, 'odam-extension-check-report.json')}`);
                        vscode.window.showInformationMessage(
                            'Verification complete! Check the Output panel for details.'
                        );
                        resolve();
                    } else {
                        const error = new Error(`Script exited with code ${code}`);
                        outputChannel.appendLine('');
                        outputChannel.appendLine(`❌ Error: ${error.message}`);
                        if (stderr) {
                            outputChannel.appendLine('\nErrors:');
                            outputChannel.appendLine(stderr);
                        }
                        vscode.window.showErrorMessage(
                            `Error while running extension check: ${error.message}`
                        );
                        reject(error);
                    }
                });

                child.on('error', (error: Error) => {
                    outputChannel.appendLine('');
                    outputChannel.appendLine(`❌ Error launching script: ${error.message}`);
                    vscode.window.showErrorMessage(
                        `Error while running extension check: ${error.message}`
                    );
                    reject(error);
                });
            });
        } catch (error: any) {
            outputChannel.appendLine('❌ Error during verification:');
            outputChannel.appendLine(error.message);
            outputChannel.appendLine(`\nError stack: ${error.stack || 'n/a'}`);

            vscode.window.showErrorMessage(
                `Error while running extension check: ${error.message}`
            );
        }
    });

    // ODAM data pipeline diagnostics command
    const diagnoseOdamCommand = vscode.commands.registerCommand('odam.diagnoseOdam', async () => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            vscode.window.showWarningMessage('Open a workspace folder');
            return;
        }

        const outputChannel = vscode.window.createOutputChannel('ODAM Diagnostics');
        outputChannel.clear();
        outputChannel.show(true);

        outputChannel.appendLine('═══════════════════════════════════════════════════════════');
        outputChannel.appendLine('🔍 ODAM DATA PIPELINE DIAGNOSTICS');
        outputChannel.appendLine('═══════════════════════════════════════════════════════════');
        outputChannel.appendLine('');

        try {
            const config = vscode.workspace.getConfiguration('odam');
            const apiUrl = config.get<string>('apiUrl', 'https://api.odam.dev');
            const apiKey = config.get<string>('apiKey', '');
            const userId = config.get<string>('userId', '');
            const sessionId = getSessionId(workspaceFolder.uri.fsPath);

            // 1. Configuration check
            outputChannel.appendLine('1️⃣ CONFIGURATION CHECK:');
            outputChannel.appendLine(`   API URL: ${apiUrl}`);
            outputChannel.appendLine(`   API Key: ${apiKey ? '***' + apiKey.slice(-4) : '❌ NOT SET'}`);
            outputChannel.appendLine(`   User ID: ${userId || '❌ NOT SET'}`);
            outputChannel.appendLine(`   Session ID: ${sessionId}`);
            outputChannel.appendLine(`   Enabled: ${config.get<boolean>('enabled', false) ? '✅' : '❌'}`);
            outputChannel.appendLine('');

            if (!apiKey || !userId) {
                outputChannel.appendLine('❌ ISSUE: API Key or User ID is not set!');
                outputChannel.appendLine('   Run command: ODAM: Configure Memory');
                return;
            }

            // 2. API health check
            outputChannel.appendLine('2️⃣ ODAM API AVAILABILITY:');
            if (!odamClient) {
                outputChannel.appendLine('   ❌ ODAM Client is not initialized');
                return;
            }

            const isHealthy = await odamClient.healthCheck();
            outputChannel.appendLine(`   Health Check: ${isHealthy ? '✅ OK' : '❌ FAILED'}`);
            outputChannel.appendLine('');

            // 3. Memory statistics
            outputChannel.appendLine('3️⃣ ODAM MEMORY STATISTICS:');
            const stats = await odamClient.getMemoryStats(userId, sessionId);
            if (stats) {
                outputChannel.appendLine(`   ✅ Data fetched from ODAM:`);
                outputChannel.appendLine(`   - Total memories: ${stats.total_memories}`);
                outputChannel.appendLine(`   - Entities: ${stats.entities_count}`);
                outputChannel.appendLine(`   - Graph nodes: ${stats.graph_nodes || 0}`);
                outputChannel.appendLine(`   - Memory health: ${(stats.memory_health_score * 100).toFixed(1)}%`);
                
                if (stats.total_memories === 0 && stats.entities_count === 0) {
                    outputChannel.appendLine('');
                    outputChannel.appendLine('⚠️ WARNING: Memory is empty!');
                    outputChannel.appendLine('   This means data is NOT being saved to ODAM.');
                    outputChannel.appendLine('   Check Developer Tools console logs:');
                    outputChannel.appendLine('   - Help → Toggle Developer Tools → Console');
                    outputChannel.appendLine('   - Look for logs: [ODAM Client] 📤 Recording code artifact');
                    outputChannel.appendLine('   - Look for errors: [ODAM Client] ❌ recordCodeArtifact error');
                } else {
                    outputChannel.appendLine('');
                    outputChannel.appendLine('✅ Data is stored in ODAM!');
                }
            } else {
                outputChannel.appendLine('   ❌ Failed to get statistics');
                outputChannel.appendLine('   Check ODAM API connectivity');
            }
            outputChannel.appendLine('');

            // 4. Hook pipeline check
            outputChannel.appendLine('4️⃣ HOOK PIPELINE CHECK:');
            const hooksConfigPath = require('path').join(require('os').homedir(), '.cursor', 'hooks.json');
            const fs = require('fs');
            if (fs.existsSync(hooksConfigPath)) {
                const hooksConfig = JSON.parse(fs.readFileSync(hooksConfigPath, 'utf8'));
                const hooks = hooksConfig.hooks || {};
                outputChannel.appendLine(`   ✅ hooks.json found: ${hooksConfigPath}`);
                outputChannel.appendLine(`   - beforeSubmitPrompt: ${hooks.beforeSubmitPrompt ? '✅' : '❌'}`);
                outputChannel.appendLine(`   - afterAgentResponse: ${hooks.afterAgentResponse ? '✅' : '❌'}`);
                outputChannel.appendLine(`   - afterAgentThought: ${hooks.afterAgentThought ? '✅' : '❌'}`);
            } else {
                outputChannel.appendLine(`   ❌ hooks.json not found: ${hooksConfigPath}`);
            }
            outputChannel.appendLine('');

            // 5. How to inspect logs
            outputChannel.appendLine('5️⃣ HOW TO CHECK LOGS:');
            outputChannel.appendLine('   a) Open Developer Tools: Help → Toggle Developer Tools');
            outputChannel.appendLine('   b) Switch to the Console tab');
            outputChannel.appendLine('   c) Send a message in Cursor chat');
            outputChannel.appendLine('   d) Look for logs:');
            outputChannel.appendLine('      - [HookEventProcessor] after: received');
            outputChannel.appendLine('      - [ODAM Client] 📤 Recording code artifact');
            outputChannel.appendLine('      - [ODAM Client] ✅ Code artifact recorded successfully');
            outputChannel.appendLine('      - or [ODAM Client] ❌ recordCodeArtifact error (if something failed)');
            outputChannel.appendLine('');

            outputChannel.appendLine('═══════════════════════════════════════════════════════════');
            outputChannel.appendLine('Diagnostics completed. Review the logs above.');
            outputChannel.appendLine('═══════════════════════════════════════════════════════════');

        } catch (error: any) {
            outputChannel.appendLine(`❌ ERROR: ${error.message}`);
            outputChannel.appendLine(`Stack: ${error.stack}`);
        }
    });

    context.subscriptions.push(
        configureCommand,
        showMemoryCommand,
        resetMemoryCommand,
        toggleCommand,
        updateMemoryCommand,
        debugODAMCommand,
        showMemoryContextCommand,
        compareRequestResponseCommand,
        analyzeMemoryUsageCommand,
        recordArtifactsCommand,
        checkExtensionCommand,
        viewContextLogsCommand,
        viewOdamDataCommand,
        diagnoseOdamCommand
    );
}

/**
 * Register event listeners
 */
function setupEventListeners(
    context: vscode.ExtensionContext,
    client: OdamClient,
    userId: string,
    fileUpdater: MemoryFileUpdater,
    artifactTracker: CodeArtifactTracker,
    styleTracker?: CodeStyleTracker | null
) {
    // Listen for configuration changes
    vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('odam')) {
            const config = vscode.workspace.getConfiguration('odam');
            const enabled = config.get<boolean>('enabled', false);
            
            if (statusBar) {
                statusBar.updateStatus(enabled);
            }
        }
    });

    // Track document edits to record artifacts
    const documentChangeDisposable = vscode.workspace.onDidChangeTextDocument((event) => {
        if (codeArtifactTracker) {
            codeArtifactTracker.trackDocumentChange(event);
        }
    });

    // Track file saves
    const documentSaveDisposable = vscode.workspace.onDidSaveTextDocument(async (document) => {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (codeArtifactTracker && workspaceFolder) {
            await codeArtifactTracker.trackDocumentSave(document, workspaceFolder);
        }
        // Track coding style
        if (styleTracker && workspaceFolder) {
            await styleTracker.trackFileStyle(document, workspaceFolder).catch((err: any) => {
                console.error('Error tracking code style:', err);
            });
        }
    });

    // HookEventServer handles memory updates, so skip updateMemoryFile('') here
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder && memoryFileUpdater) {
        console.log('[Extension] Hook event pipeline is active for memory updates');
    }

    // Register disposables for cleanup
    context.subscriptions.push(documentChangeDisposable, documentSaveDisposable);
}

/**
 * Generate a unique user ID
 */
function generateUserId(): string {
    const os = require('os');
    const username = os.userInfo().username;
    const hostname = os.hostname();
    const hash = require('crypto').createHash('sha256');
    hash.update(`${username}@${hostname}`);
    return hash.digest('hex').substring(0, 16);
}

/**
 * Derive session_id for the project
 */
function getSessionId(workspacePath: string): string {
    const path = require('path');
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(workspacePath);
    return hash.digest('hex').substring(0, 16);
}

/**
 * Get workspace-specific output channel name
 * This ensures each workspace has its own output channels, preventing log mixing
 */
function getWorkspaceOutputChannelName(baseName: string, workspaceFolder?: vscode.WorkspaceFolder): string {
    if (!workspaceFolder) {
        workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    }
    
    if (workspaceFolder) {
        const path = require('path');
        const workspaceName = path.basename(workspaceFolder.uri.fsPath);
        return `${baseName} (${workspaceName})`;
    }
    
    return baseName;
}

