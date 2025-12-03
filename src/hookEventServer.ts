import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { HookEventProcessor, HookPromptPayload, HookResponsePayload, HookThoughtPayload } from './hookEventProcessor';
import * as vscode from 'vscode';

interface HookServerConfig {
    port: number;
    token: string;
    updatedAt: string;
}

export class HookEventServer implements vscode.Disposable {
    private processor: HookEventProcessor;
    private server: http.Server | null = null;
    private configPath: string;
    private token: string = crypto.randomBytes(24).toString('hex');
    private port: number | null = null;
    private subscriptions: vscode.Disposable[] = [];

    constructor(processor: HookEventProcessor, private context: vscode.ExtensionContext) {
        this.processor = processor;
        this.configPath = path.join(os.homedir(), '.cursor', 'odam-hook-config.json');
    }

    async start(): Promise<void> {
        if (this.server) {
            return;
        }

        this.server = http.createServer(async (req, res) => {
            try {
                await this.handleRequest(req, res);
            } catch (error) {
                console.error('[HookEventServer] Request error:', error);
                res.writeHead(500, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'internal_error' }));
            }
        });

        await new Promise<void>((resolve, reject) => {
            this.server?.listen(0, '127.0.0.1', () => resolve());
            this.server?.on('error', (error) => reject(error));
        });

        const address = this.server.address();
        if (!address || typeof address === 'string') {
            throw new Error('Failed to determine hook server port');
        }

        this.port = address.port;
        this.writeConfig();

        const disposable = {
            dispose: () => this.dispose()
        };

        this.context.subscriptions.push(disposable);
        this.subscriptions.push(disposable);

        console.log('[HookEventServer] Listening on port', this.port);
    }

    dispose(): void {
        if (this.server) {
            this.server.close();
            this.server = null;
        }

        this.port = null;
        this.processor.clear();

        if (fs.existsSync(this.configPath)) {
            try {
                fs.unlinkSync(this.configPath);
            } catch (error) {
                console.warn('[HookEventServer] Failed to remove config file:', error);
            }
        }

        this.subscriptions.forEach((sub) => sub.dispose());
        this.subscriptions = [];
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method !== 'POST') {
            res.writeHead(405, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'method_not_allowed' }));
            return;
        }

        if (!this.validateToken(req)) {
            console.warn('[HookEventServer] Unauthorized request');
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'unauthorized' }));
            return;
        }

        const rawBody = await this.readRawBody(req);
        if (!rawBody) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'empty_body' }));
            return;
        }
        let body: any;
        try {
            body = JSON.parse(rawBody);
        } catch (error) {
            console.error('[HookEventServer] Failed to parse payload:', error);
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_json' }));
            return;
        }

        const url = new URL(req.url ?? '/', 'http://localhost');
        console.log('[HookEventServer] Event received', {
            path: url.pathname,
            length: rawBody.length,
            tokenChecked: true
        });
        switch (url.pathname) {
            case '/hook/before':
                await this.processor.handleBeforePrompt(body as HookPromptPayload);
                break;
            case '/hook/after':
                await this.processor.handleAfterResponse(body as HookResponsePayload);
                break;
            case '/hook/thought':
                await this.processor.handleAfterThought(body as HookThoughtPayload);
                break;
            default:
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'not_found' }));
                return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
    }

    private validateToken(req: http.IncomingMessage): boolean {
        const header = req.headers['x-odam-hook-token'];
        if (!header || typeof header !== 'string') {
            return false;
        }

        return header === this.token;
    }

    private async readRawBody(req: http.IncomingMessage): Promise<string | null> {
        const chunks: Buffer[] = [];

        for await (const chunk of req) {
            chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }

        if (chunks.length === 0) {
            return null;
        }

        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw.trim()) {
            return null;
        }
        return raw;
    }

    private writeConfig(): void {
        if (this.port === null) {
            return;
        }

        const config: HookServerConfig = {
            port: this.port,
            token: this.token,
            updatedAt: new Date().toISOString()
        };

        const dir = path.dirname(this.configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf8');
    }
}




