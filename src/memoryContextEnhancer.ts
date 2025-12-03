/**
 * Memory Context Enhancer
 * Builds a richer context by reusing Code Memory history:
 * - Analyses entity history to detect what worked vs what failed
 * - Builds dedicated sections for “Known Issues” and “Proven Solutions”
 * - Uses status/outcome/test_status metadata for better structure
 */

import { CodeMemoryResponse, CodeArtifact } from './odamClient';

export interface EnhancedContextSection {
    title: string;
    items: Array<{
        label: string;
        values: string[];
    }>;
}

export class MemoryContextEnhancer {
    /**
     * Enhance context using previously stored entities
     */
    enhanceContext(codeMemory: CodeMemoryResponse): CodeMemoryResponse {
        if (!codeMemory.entities || codeMemory.entities.length === 0) {
            return codeMemory;
        }

        // Analyse artifacts to understand what worked and what failed
        const successfulArtifacts = this.findSuccessfulArtifacts(codeMemory.entities);
        const problematicArtifacts = this.findProblematicArtifacts(codeMemory.entities);
        const effectiveSolutions = this.findEffectiveSolutions(codeMemory.entities);

        // Use the analysis to build new sections
        const enhancedSections = this.buildEnhancedSections(
            codeMemory.sections || [],
            successfulArtifacts,
            problematicArtifacts,
            effectiveSolutions
        );

        return {
            ...codeMemory,
            sections: enhancedSections
        };
    }

    /**
     * Find successful artifacts (passed tests / marked as success)
     */
    private findSuccessfulArtifacts(entities: any[]): any[] {
        return entities.filter(entity => {
            const props = entity.properties || {};
            return (
                props.status === 'success' &&
                (props.test_status === 'passed' || !props.test_status)
            );
        });
    }

    /**
     * Find problematic artifacts (failed / regression)
     */
    private findProblematicArtifacts(entities: any[]): any[] {
        return entities.filter(entity => {
            const props = entity.properties || {};
            return (
                props.status === 'failed' ||
                props.outcome === 'regression' ||
                (props.test_status === 'failed')
            );
        });
    }

    /**
     * Find effective solutions (implemented fixes with successful status)
     */
    private findEffectiveSolutions(entities: any[]): any[] {
        return entities.filter(entity => {
            const props = entity.properties || {};
            return (
                props.status === 'success' &&
                (props.test_status === 'passed' || !props.test_status) &&
                (props.outcome === 'implemented' || props.outcome === 'bug_fixed' || props.outcome === 'optimized')
            );
        });
    }

    /**
     * Build enhanced sections enriched with historical analysis
     */
    private buildEnhancedSections(
        existingSections: Array<{ title: string; items: Array<{ label: string; values: string[] }> }>,
        successfulArtifacts: any[],
        problematicArtifacts: any[],
        effectiveSolutions: any[]
    ): Array<{ title: string; items: Array<{ label: string; values: string[] }> }> {
        const sections: Array<{ title: string; items: Array<{ label: string; values: string[] }> }> = [];

        // 1. Technical profile (reuse existing section if possible)
        const techProfileSection =
            existingSections.find(s =>
                s.title.toLowerCase().includes('technical profile')
            ) || { title: 'Technical Profile', items: [] };

        // Add successful artifacts to the technical profile
        if (successfulArtifacts.length > 0) {
            const languages = this.groupByCategory(successfulArtifacts, 'language');
            for (const [category, artifacts] of Object.entries(languages)) {
                const values = artifacts.map(a => this.formatArtifactForContext(a, true));
                techProfileSection.items.push({
                    label: category || 'Languages / DSL',
                    values
                });
            }
        }

        sections.push(techProfileSection);

        // 2. Proven solutions
        if (effectiveSolutions.length > 0) {
            const solutionsSection = {
                title: 'Proven Solutions',
                items: [{
                    label: 'Solutions',
                    values: effectiveSolutions.map(a => this.formatArtifactForContext(a, true))
                }]
            };
            sections.push(solutionsSection);
        }

        // 3. Known issues
        if (problematicArtifacts.length > 0) {
            const problemsSection = {
                title: 'Known Issues',
                items: [{
                    label: 'Problems',
                    values: problematicArtifacts.map(a => this.formatArtifactForContext(a, false))
                }]
            };
            sections.push(problemsSection);
        }

        // 4. Keep the rest of existing sections (avoid duplicates)
        const existingTitles = sections.map(s => s.title.toLowerCase());
        for (const section of existingSections) {
            if (!existingTitles.includes(section.title.toLowerCase())) {
                sections.push(section);
            }
        }

        return sections;
    }

    /**
     * Format artifact for context output
     */
    private formatArtifactForContext(artifact: any, isSuccessful: boolean): string {
        const props = artifact.properties || {};
        const parts: string[] = [artifact.name];

        // Add status
        if (props.status) {
            parts.push(`[${props.status}]`);
        }

        // Append details
        const details: string[] = [];
        
        if (props.status) {
            details.push(`status: ${props.status}`);
        }
        
        if (props.outcome) {
            details.push(`outcome: ${props.outcome}`);
        }
        
        if (props.test_status) {
            details.push(`test_status: ${props.test_status}`);
        }
        
        if (props.path) {
            details.push(`path: ${props.path}`);
        }
        
        if (props.language) {
            details.push(`language: ${props.language}`);
        }

        if (artifact.confidence) {
            details.push(`conf=${artifact.confidence.toFixed(2)}`);
        }

        if (details.length > 0) {
            parts.push(`(${details.join(', ')})`);
        }

        return parts.join(' ');
    }

    /**
     * Group artifacts by category key
     */
    private groupByCategory(artifacts: any[], categoryKey: string): { [key: string]: any[] } {
        const grouped: { [key: string]: any[] } = {};

        for (const artifact of artifacts) {
            const category = artifact.category || 
                           artifact.properties?.[categoryKey] || 
                           'Other';
            
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push(artifact);
        }

        return grouped;
    }

    /**
     * Enhance context_text with history-based tips
     */
    enhanceContextText(
        contextText: string,
        successfulArtifacts: any[],
        problematicArtifacts: any[],
        effectiveSolutions: any[]
    ): string {
        const parts: string[] = [];

        if (contextText) {
            parts.push(contextText);
        }

        // Add guidance based on past success
        if (effectiveSolutions.length > 0) {
            parts.push('\n### Recommendations from history:');
            parts.push('- Prefer approaches that already proved effective.');
            
            const solutionNames = effectiveSolutions
                .slice(0, 3)
                .map(a => a.name)
                .join(', ');
            if (solutionNames) {
                parts.push(`- Use ${solutionNames} as references for successful implementation.`);
            }
        }

        if (problematicArtifacts.length > 0) {
            parts.push('\n### Warnings:');
            const problemNames = problematicArtifacts
                .slice(0, 3)
                .map(a => a.name)
                .join(', ');
            if (problemNames) {
                parts.push(`- Avoid approaches similar to ${problemNames} that previously caused issues.`);
            }
        }

        return parts.join('\n');
    }
}































