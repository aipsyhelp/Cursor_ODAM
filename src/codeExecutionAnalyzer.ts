/**
 * Code Execution Analyzer
 * Evaluates code diagnostics/tests/diffs to derive status/outcome metadata
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface ExecutionAnalysis {
    status: 'success' | 'failed' | 'draft';
    outcome?: 'implemented' | 'bug_fixed' | 'regression' | 'refactored' | 'optimized';
    test_status?: 'passed' | 'failed' | 'skipped' | 'partial';
    diff?: string;
    execution_time?: number;
    errors?: string[];
    warnings?: string[];
}

export class CodeExecutionAnalyzer {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private previousFileVersions: Map<string, string> = new Map();
    private executionStartTimes: Map<string, number> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('odam-code-analysis');
        context.subscriptions.push(this.diagnosticCollection);
    }

    /**
     * Analyse document diagnostics/tests/diff and build ExecutionAnalysis
     */
    async analyzeExecution(
        document: vscode.TextDocument,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<ExecutionAnalysis> {
        const analysis: ExecutionAnalysis = {
            status: 'draft',
            errors: [],
            warnings: []
        };

        // 1. Collect VS Code diagnostics
        const diagnostics = vscode.languages.getDiagnostics(document.uri);
        const errors = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Error);
        const warnings = diagnostics.filter(d => d.severity === vscode.DiagnosticSeverity.Warning);

        analysis.errors = errors.map(e => e.message);
        analysis.warnings = warnings.map(w => w.message);

        // Determine status based on diagnostics
        if (errors.length > 0) {
            analysis.status = 'failed';
        } else if (warnings.length > 0) {
            analysis.status = 'draft'; // warnings exist but not fatal
        } else {
            analysis.status = 'success';
        }

        // 2. Fetch diff (if git is available)
        const diff = await this.getGitDiff(document, workspaceFolder);
        if (diff) {
            analysis.diff = diff;
            analysis.outcome = this.analyzeDiffForOutcome(diff, document);
        }

        // 3. Determine test status
        analysis.test_status = await this.checkTestStatus(document, workspaceFolder);

        // 4. Measure execution time if tracked
        const executionTime = this.getExecutionTime(document.uri.fsPath);
        if (executionTime) {
            analysis.execution_time = executionTime;
        }

        return analysis;
    }

    /**
     * Get git diff for the file
     */
    private async getGitDiff(
        document: vscode.TextDocument,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<string | undefined> {
        try {
            const gitExtension = vscode.extensions.getExtension('vscode.git');
            if (!gitExtension || !gitExtension.isActive) {
                return undefined;
            }

            const git = gitExtension.exports.getAPI(1);
            if (!git) {
                return undefined;
            }

            const repository = git.getRepository(workspaceFolder.uri);
            if (!repository) {
                return undefined;
            }

            // Get diff for this file
            const relativePath = path.relative(workspaceFolder.uri.fsPath, document.uri.fsPath);
            const diff = await repository.diffWithHEAD(relativePath);
            
            if (!diff) {
                return undefined;
            }
            
            return diff || undefined;
        } catch (error) {
            console.warn('[Code Execution Analyzer] Failed to get Git diff:', error);
            return undefined;
        }
    }

    /**
     * Infer outcome from the diff
     */
    private analyzeDiffForOutcome(
        diff: string,
        document: vscode.TextDocument
    ): ExecutionAnalysis['outcome'] {
        if (!diff || diff.trim().length === 0) {
            return 'implemented'; // New file or first version
        }

        const diffLower = diff.toLowerCase();
        const content = document.getText().toLowerCase();

        // Heuristic: regression when deletions exceed additions
        const deletions = diff.match(/^\-/gm);
        const additions = diff.match(/^\+/gm);
        if (diff.includes('---') && deletions && additions && deletions.length > additions.length) {
            if (diffLower.includes('fix') || diffLower.includes('bug')) {
                return 'bug_fixed';
            }
            return 'regression';
        }

        // Optimization hints
        if (diffLower.includes('optimize') || diffLower.includes('performance') || 
            diffLower.includes('cache') || diffLower.includes('lazy')) {
            return 'optimized';
        }

        // Refactor detection
        if (diffLower.includes('refactor') || diffLower.includes('cleanup') ||
            diffLower.includes('rename') || diffLower.includes('extract')) {
            return 'refactored';
        }

        // Bug fix keywords
        if (diffLower.includes('fix') || diffLower.includes('bug') || 
            diffLower.includes('error') || diffLower.includes('issue')) {
            return 'bug_fixed';
        }

        // Default outcome
        return 'implemented';
    }

    /**
     * Infer test status / availability
     */
    private async checkTestStatus(
        document: vscode.TextDocument,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<ExecutionAnalysis['test_status']> {
        try {
            // Determine whether this is a test file
            const filePath = document.uri.fsPath;
            const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
            
            // Regexes for typical test filenames
            const testPatterns = [
                /\.test\./,
                /\.spec\./,
                /test_/,
                /_test\./
            ];

            const isTestFile = testPatterns.some(pattern => pattern.test(relativePath));
            
            if (isTestFile) {
                // TODO: integrate with test runners via Task API
                return undefined;
            }

            // See if related tests exist
            const testFiles = await this.findTestFiles(filePath, workspaceFolder);
            if (testFiles.length === 0) {
                return 'skipped'; // No tests available
            }

            // TODO: integrate with test runners (Jest/Mocha/PyTest/etc.)

            return undefined;
        } catch (error) {
            console.warn('[Code Execution Analyzer] Failed to check test status:', error);
            return undefined;
        }
    }

    /**
     * Find potential test files referencing the source file
     */
    private async findTestFiles(
        codeFilePath: string,
        workspaceFolder: vscode.WorkspaceFolder
    ): Promise<string[]> {
        const testFiles: string[] = [];
        const codeFileName = path.basename(codeFilePath, path.extname(codeFilePath));
        const codeDir = path.dirname(codeFilePath);
        const relativeDir = path.relative(workspaceFolder.uri.fsPath, codeDir);

        // Look inside sibling directories and common test folders
        const searchPaths = [
            codeDir,
            path.join(workspaceFolder.uri.fsPath, 'test'),
            path.join(workspaceFolder.uri.fsPath, 'tests'),
            path.join(workspaceFolder.uri.fsPath, '__tests__'),
            path.join(codeDir, '..', 'test'),
            path.join(codeDir, '..', 'tests')
        ];

        for (const searchPath of searchPaths) {
            if (!fs.existsSync(searchPath)) {
                continue;
            }

            try {
                const files = fs.readdirSync(searchPath);
                for (const file of files) {
                    const filePath = path.join(searchPath, file);
                    const stat = fs.statSync(filePath);
                    
                    if (stat.isFile()) {
                        const fileName = path.basename(file, path.extname(file));
                        // Check whether the file name references the source file
                        if (fileName.includes(codeFileName) || 
                            fileName.includes(codeFileName.replace(/\.[^.]*$/, ''))) {
                            testFiles.push(filePath);
                        }
                    }
                }
            } catch (error) {
                // Ignore file system errors
            }
        }

        return testFiles;
    }

    /**
     * Get measured execution time for file run
     */
    private getExecutionTime(filePath: string): number | undefined {
        const startTime = this.executionStartTimes.get(filePath);
        if (startTime) {
            const executionTime = Date.now() - startTime;
            this.executionStartTimes.delete(filePath);
            return executionTime;
        }
        return undefined;
    }

    /**
     * Track execution start timestamp
     */
    trackExecutionStart(filePath: string): void {
        this.executionStartTimes.set(filePath, Date.now());
    }

    /**
     * Cache previous file contents for comparison
     */
    saveFileVersion(filePath: string, content: string): void {
        this.previousFileVersions.set(filePath, content);
    }

    /**
     * Retrieve cached version
     */
    getPreviousVersion(filePath: string): string | undefined {
        return this.previousFileVersions.get(filePath);
    }

    /**
     * Reset cached versions and timers
     */
    clearVersions(): void {
        this.previousFileVersions.clear();
        this.executionStartTimes.clear();
    }

    dispose(): void {
        this.diagnosticCollection.dispose();
        this.clearVersions();
    }
}

