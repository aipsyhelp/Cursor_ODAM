#!/usr/bin/env node

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as http from 'http';

type HookType = 'before' | 'after' | 'thought';

interface HookRunnerConfig {
    port: number;
    token: string;
}

async function readStdin(): Promise<string> {
    return new Promise((resolve) => {
        const chunks: Buffer[] = [];
        process.stdin.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

function loadConfig(): HookRunnerConfig | null {
    const configPath = process.env.ODAM_HOOK_CONFIG || path.join(os.homedir(), '.cursor', 'odam-hook-config.json');
    if (!fs.existsSync(configPath)) {
        console.error('[cursor-odam-hook] Config file not found:', configPath);
        return null;
    }

    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.port === 'number' && typeof parsed.token === 'string') {
            return parsed as HookRunnerConfig;
        }
    } catch (error) {
        console.error('[cursor-odam-hook] Failed to read config:', error);
    }

    return null;
}

async function dispatchEvent(event: HookType, payload: string, config: HookRunnerConfig): Promise<void> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                hostname: '127.0.0.1',
                port: config.port,
                path: `/hook/${event}`,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-ODAM-Hook-Token': config.token
                },
                timeout: 5000
            },
            (res) => {
                let responseData = '';
                res.on('data', (chunk) => {
                    responseData += chunk.toString();
                });
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        // Log to stderr to avoid polluting stdout (Cursor expects JSON or empty output)
                        console.error(`[cursor-odam-hook] ✅ Event ${event} sent successfully (${payload.length} bytes)`);
                        resolve();
                    } else {
                        console.error(`[cursor-odam-hook] ❌ Server returned status ${res.statusCode}: ${responseData}`);
                        reject(new Error(`Server error: ${res.statusCode}`));
                    }
                });
                res.on('error', (error) => {
                    console.error('[cursor-odam-hook] ❌ Response error:', error.message);
                    reject(error);
                });
            }
        );

        req.on('error', (error) => {
            console.error('[cursor-odam-hook] ❌ Failed to reach ODAM hook server:', error.message);
            reject(error);
        });

        req.write(payload || '{}');
        req.end();
    });
}

async function main() {
    const type = (process.argv[2] || '').trim().toLowerCase() as HookType;
    if (!['before', 'after', 'thought'].includes(type)) {
        console.error('[cursor-odam-hook] ❌ Unknown hook type:', type);
        process.exit(1);
        return;
    }

    const payload = await readStdin();
    if (!payload || payload.trim().length === 0) {
        console.error('[cursor-odam-hook] ❌ Empty payload received from stdin');
        process.exit(1);
        return;
    }

    const config = loadConfig();
    if (!config) {
        console.error('[cursor-odam-hook] ❌ Failed to load config');
        process.exit(1);
        return;
    }

    try {
        await dispatchEvent(type, payload, config);
        process.exit(0);
    } catch (error: any) {
        console.error('[cursor-odam-hook] ❌ Failed to dispatch event:', error.message);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('[cursor-odam-hook] ❌ Unexpected error:', error);
    process.exit(1);
});








