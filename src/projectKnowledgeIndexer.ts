import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { OdamClient, CodeArtifact, CodeInteractionPayload } from './odamClient';
import { ContextLogger } from './contextLogger';

interface DocSection {
    title: string;
    body: string;
}

interface FileToIndex {
    absolutePath: string;
    relativePath: string;
}

export class ProjectKnowledgeIndexer {
    private readonly client: OdamClient;
    private readonly userId: string;
    private readonly state: vscode.Memento;
    private readonly logger?: ContextLogger;
    private readonly outputChannel: vscode.OutputChannel;

    constructor(client: OdamClient, userId: string, globalState: vscode.Memento, logger?: ContextLogger) {
        this.client = client;
        this.userId = userId;
        this.state = globalState;
        this.logger = logger;
        this.outputChannel = vscode.window.createOutputChannel('ODAM Project Indexer');
    }

    async indexWorkspace(workspaceFolder: vscode.WorkspaceFolder, force = false): Promise<void> {
        const sessionId = this.getSessionId(workspaceFolder.uri.fsPath);
        const cacheKey = `odam.indexed.${sessionId}`;
        const lastIndexed = this.state.get<number>(cacheKey);

        if (!force && lastIndexed && Date.now() - lastIndexed < 1000 * 60 * 60) {
            this.log(`Skipping project indexing (already indexed ${(Date.now() - lastIndexed) / 1000 | 0}s ago)`);
            return;
        }

        const files = this.collectFiles(workspaceFolder);
        if (files.length === 0) {
            this.log('No documentation files found for indexing');
            return;
        }

        this.log(`Starting project documentation indexing (${files.length} files)`);

        for (const file of files) {
            try {
                const content = fs.readFileSync(file.absolutePath, 'utf8');
                const sections = this.extractSections(content).slice(0, 6);

                if (sections.length === 0) {
                    continue;
                }

                this.log(`Indexing "${file.relativePath}" (${sections.length} sections)`);

                for (const section of sections) {
                    await this.recordSection(sessionId, file.relativePath, section);
                    await this.sleep(400);
                }
            } catch (error) {
                console.error('[ProjectKnowledgeIndexer] Failed to index file:', file.absolutePath, error);
            }
        }

        await this.state.update(cacheKey, Date.now());
        this.log('Project documentation indexing completed');
    }

    private collectFiles(workspaceFolder: vscode.WorkspaceFolder): FileToIndex[] {
        const candidates = [
            'README.md',
            'PROJECT_STRUCTURE.md',
            path.join('docs', 'work_plan.md'),
            path.join('docs', 'ODAM_CURSOR_EXTENSION_CORRECT_INTEGRATION.md')
        ];

        const existing: FileToIndex[] = [];
        for (const relative of candidates) {
            const absolutePath = path.join(workspaceFolder.uri.fsPath, relative);
            if (fs.existsSync(absolutePath)) {
                existing.push({
                    absolutePath,
                    relativePath: relative
                });
            }
        }
        return existing;
    }

    private extractSections(content: string): DocSection[] {
        const lines = content.split(/\r?\n/);
        const sections: DocSection[] = [];

        let currentTitle = 'Introduction';
        let currentBody: string[] = [];

        const pushCurrent = () => {
            const bodyText = currentBody.join('\n').trim();
            if (bodyText.length > 0) {
                sections.push({
                    title: currentTitle,
                    body: bodyText
                });
            }
            currentBody = [];
        };

        for (const line of lines) {
            if (/^#{1,6}\s+/.test(line)) {
                pushCurrent();
                currentTitle = line.replace(/^#{1,6}\s+/, '').trim() || currentTitle;
            } else {
                currentBody.push(line);
            }
        }

        pushCurrent();
        return sections;
    }

    private async recordSection(sessionId: string, relativePath: string, section: DocSection): Promise<void> {
        const summary = this.createSummary(section);
        const chunk = this.truncate(`${section.body}`.replace(/\s+/g, ' ').trim(), 1600);
        const tags = this.deriveTags(section);

        const artifacts: CodeArtifact[] = [
            {
                identifier: `${relativePath}#${section.title || 'section'}`,
                path: relativePath,
                language: 'markdown',
                summary,
                status: 'success',
                tags,
                outcome: 'documented'
            }
        ];

        const payload: CodeInteractionPayload = {
            user_id: this.userId,
            session_id: sessionId,
            query: `Documentation ${relativePath}: ${section.title}`,
            response: `${summary}\n\n${chunk}`,
            artifacts,
            metadata: {
                step: 0,
                ticket: 'project-knowledge-bootstrap'
            }
        };

        const result = await this.client.recordCodeArtifact(payload);
        if (result?.success) {
            this.log(`Indexed section "${section.title}" from ${relativePath} (entities=${result.memories_created})`);
            if (this.logger) {
                this.logger.logOdamSave(payload.query, this.userId, sessionId, 'user_query');
            }
        } else {
            console.warn('[ProjectKnowledgeIndexer] Failed to store section', {
                title: section.title,
                relativePath
            });
        }
    }

    private createSummary(section: DocSection): string {
        const normalized = section.body.replace(/\s+/g, ' ').trim();
        const trimmed = this.truncate(normalized, 280);
        return `${section.title}: ${trimmed}`;
    }

    private deriveTags(section: DocSection): string[] {
        const text = `${section.title} ${section.body}`.toLowerCase();
        const tagMatchers: Array<{ tag: string; pattern: RegExp }> = [
            { tag: 'typescript', pattern: /typescript|ts|javascript/ },
            { tag: 'nodejs', pattern: /node\.js|nodejs|express/ },
            { tag: 'python', pattern: /python|fastapi/ },
            { tag: 'memory', pattern: /memory/ },
            { tag: 'architecture', pattern: /architecture/ },
            { tag: 'integration', pattern: /integration/ },
            { tag: 'graph', pattern: /neo4j|graph/ },
            { tag: 'search', pattern: /opensearch|search/ }
        ];

        const tags = tagMatchers
            .filter(matcher => matcher.pattern.test(text))
            .map(matcher => matcher.tag);

        if (tags.length === 0) {
            tags.push('documentation');
        }

        return tags;
    }

    private truncate(text: string, max: number): string {
        if (text.length <= max) {
            return text;
        }
        return `${text.substring(0, max - 3)}...`;
    }

    private getSessionId(workspacePath: string): string {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(workspacePath);
        return hash.digest('hex').substring(0, 16);
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private log(message: string): void {
        const line = `[ProjectKnowledgeIndexer] ${message}`;
        console.log(line);
        this.outputChannel.appendLine(`[${new Date().toISOString()}] ${message}`);
    }
}


