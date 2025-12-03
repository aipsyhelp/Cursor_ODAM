/**
 * Memory Status Bar
 * Displays ODAM Memory status in the VS Code status bar
 */

import * as vscode from 'vscode';
import { MemoryStats } from './odamClient';

export class MemoryStatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private enabled: boolean = false;

    constructor(context: vscode.ExtensionContext) {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.statusBarItem.command = 'odam.toggle';
        this.statusBarItem.tooltip = 'ODAM Memory – click to toggle';
        context.subscriptions.push(this.statusBarItem);
        
        this.updateStatus(false);
        this.statusBarItem.show();
    }

    /**
     * Update status indicator
     */
    updateStatus(enabled: boolean): void {
        this.enabled = enabled;
        if (enabled) {
            this.statusBarItem.text = '$(brain) ODAM';
            this.statusBarItem.backgroundColor = undefined;
        } else {
            this.statusBarItem.text = '$(brain) ODAM (off)';
            this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
    }

    /**
     * Update tooltip with memory statistics
     */
    updateTooltip(stats: MemoryStats | null): void {
        if (stats) {
            this.statusBarItem.tooltip = `ODAM Memory: Total memories: ${stats.total_memories}\n` +
                `Entities: ${stats.entities_count}\n` +
                `Graph nodes: ${stats.graph_nodes || 0}\n` +
                `Memory health: ${(stats.memory_health_score * 100).toFixed(1)}%\n` +
                `Source: ODAM Memory for Cursor`;
        } else {
            this.statusBarItem.tooltip = 'ODAM Memory – click to toggle\nUnable to fetch statistics';
        }
    }

    /**
     * Show activity indicator
     */
    showActivity(): void {
        if (this.enabled) {
            this.statusBarItem.text = '$(sync~spin) ODAM';
        }
    }

    /**
     * Hide activity indicator
     */
    hideActivity(): void {
        this.updateStatus(this.enabled);
    }

    dispose(): void {
        this.statusBarItem.dispose();
    }
}



