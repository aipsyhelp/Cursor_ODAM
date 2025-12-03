/**
 * MCP Server for ODAM Memory Integration
 * Implements a Model Context Protocol server for Cursor AI
 */

import { OdamClient } from './odamClient';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface MCPServerConfig {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
}

export class MCPServerManager {
    private client: OdamClient;
    private userId: string;
    private serverProcess: any = null;

    constructor(client: OdamClient, userId: string) {
        this.client = client;
        this.userId = userId;
    }

    /**
     * Create MCP server configuration for Cursor
     */
    async createMCPConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        const mcpConfigPath = path.join(workspaceFolder.uri.fsPath, '.cursor', 'mcp.json');
        const mcpDir = path.dirname(mcpConfigPath);

        // Ensure `.cursor` exists
        if (!fs.existsSync(mcpDir)) {
            fs.mkdirSync(mcpDir, { recursive: true });
        }

        // Resolve Node.js executable path
        const nodePath = process.execPath;
        const extensionPath = vscode.extensions.getExtension('odam.cursor-odam-extension')?.extensionPath;
        
        if (!extensionPath) {
            throw new Error('Extension path not found');
        }

        const serverScriptPath = path.join(extensionPath, 'out', 'mcpServer.js');

        const config: MCPServerConfig = {
            name: 'odam-memory',
            command: nodePath,
            args: [serverScriptPath],
            env: {
                ODAM_API_URL: vscode.workspace.getConfiguration('odam').get<string>('apiUrl', 'https://api.odam.dev') || '',
                ODAM_API_KEY: vscode.workspace.getConfiguration('odam').get<string>('apiKey', '') || '',
                ODAM_USER_ID: this.userId
            }
        };

        // Read existing config if present
        let mcpConfig: any = {};
        if (fs.existsSync(mcpConfigPath)) {
            try {
                const content = fs.readFileSync(mcpConfigPath, 'utf8');
                mcpConfig = JSON.parse(content);
            } catch (error) {
                console.error('Error reading MCP config:', error);
            }
        }

        // Add or update ODAM entry
        if (!mcpConfig.mcpServers) {
            mcpConfig.mcpServers = {};
        }

        mcpConfig.mcpServers['odam-memory'] = config;

        // Persist configuration
        fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
        
        vscode.window.showInformationMessage('ODAM MCP configuration created');
    }

    /**
     * Remove ODAM MCP configuration
     */
    async removeMCPConfig(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        const mcpConfigPath = path.join(workspaceFolder.uri.fsPath, '.cursor', 'mcp.json');
        
        if (!fs.existsSync(mcpConfigPath)) {
            return;
        }

        try {
            const content = fs.readFileSync(mcpConfigPath, 'utf8');
            const mcpConfig = JSON.parse(content);
            
            if (mcpConfig.mcpServers && mcpConfig.mcpServers['odam-memory']) {
                delete mcpConfig.mcpServers['odam-memory'];
                fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2));
            }
        } catch (error) {
            console.error('Error removing MCP config:', error);
        }
    }
}



