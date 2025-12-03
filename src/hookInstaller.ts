import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface HooksConfig {
    version: number;
    hooks: Record<string, Array<{ command: string }>>;
}

export interface HookEnvironmentPaths {
    runnerPath: string;
    beforeScript: string;
    afterScript: string;
    thoughtScript: string;
    hooksConfigPath: string;
}

export function setupHookEnvironment(extensionPath: string): HookEnvironmentPaths {
    const cursorDir = path.join(os.homedir(), '.cursor');
    const binDir = path.join(cursorDir, 'bin');
    const hooksDir = path.join(cursorDir, 'hooks');
    const hooksConfigPath = path.join(cursorDir, 'hooks.json');

    ensureDirectory(binDir);
    ensureDirectory(hooksDir);

    const cliSource = path.join(extensionPath, 'out', 'bin', 'cursor-odam-hook.js');
    const runnerPath = path.join(binDir, 'cursor-odam-hook');
    installRunner(runnerPath, cliSource);

    const beforeScript = path.join(hooksDir, 'odam-before.sh');
    const afterScript = path.join(hooksDir, 'odam-after.sh');
    const thoughtScript = path.join(hooksDir, 'odam-thought.sh');

    installWrapper(beforeScript, runnerPath, 'before');
    installWrapper(afterScript, runnerPath, 'after');
    installWrapper(thoughtScript, runnerPath, 'thought');

    const config = readHooksConfig(hooksConfigPath);
    ensureHookEntry(config, 'beforeSubmitPrompt', beforeScript);
    ensureHookEntry(config, 'afterAgentResponse', afterScript);
    ensureHookEntry(config, 'afterAgentThought', thoughtScript);
    fs.writeFileSync(hooksConfigPath, JSON.stringify(config, null, 2), 'utf8');

    return {
        runnerPath,
        beforeScript,
        afterScript,
        thoughtScript,
        hooksConfigPath
    };
}

function ensureDirectory(dir: string): void {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function installRunner(runnerPath: string, cliSource: string): void {
    try {
        if (fs.existsSync(runnerPath)) {
            fs.unlinkSync(runnerPath);
        }
    } catch (error) {
        console.warn('[HookInstaller] Failed to remove existing runner:', error);
    }

    // Ensure source file exists and has correct permissions
    if (!fs.existsSync(cliSource)) {
        throw new Error(`Hook runner source not found: ${cliSource}`);
    }
    
    // Set permissions on the source file (not the symlink)
    try {
        fs.chmodSync(cliSource, 0o755);
    } catch (error) {
        console.warn('[HookInstaller] Failed to set permissions on source file:', error);
    }
    
    // Create symlink
    fs.symlinkSync(cliSource, runnerPath);
}

function installWrapper(scriptPath: string, runnerPath: string, mode: string): void {
    const content = `#!/bin/bash
# Pass stdin to hook runner
cat | "${runnerPath}" ${mode}
`;
    fs.writeFileSync(scriptPath, content, 'utf8');
    fs.chmodSync(scriptPath, 0o755);
}

function readHooksConfig(configPath: string): HooksConfig {
    if (!fs.existsSync(configPath)) {
        return { version: 1, hooks: {} };
    }

    try {
        const raw = fs.readFileSync(configPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (typeof parsed.version === 'number' && typeof parsed.hooks === 'object') {
            return parsed as HooksConfig;
        }
    } catch (error) {
        console.warn('[HookInstaller] Failed to parse hooks.json, recreating:', error);
    }

    return { version: 1, hooks: {} };
}

function ensureHookEntry(config: HooksConfig, hookName: string, command: string): void {
    if (!config.hooks[hookName]) {
        config.hooks[hookName] = [];
    }

    if (!config.hooks[hookName].some((entry) => entry.command === command)) {
        config.hooks[hookName].push({ command });
    }
}








