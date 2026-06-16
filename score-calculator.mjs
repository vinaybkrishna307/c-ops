#!/usr/bin/env node
/**
 * score-calculator.mjs
 * 
 * Reads a career-ops report .md, extracts the Machine Summary YAML,
 * recomputes the score using deterministic hard-cap rules,
 * and overwrites the score in both the YAML block and the report header.
 *
 * Usage:
 *   node score-calculator.mjs <report-path.md>
 *
 * Exit codes:
 *   0 = success (score may have been adjusted or confirmed)
 *   1 = error (file not found, no YAML block, parse failure)
 */

import { readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';

async function main() {
  const args = process.argv.slice(2);
  if (!args[0]) {
    console.error('Usage: node score-calculator.mjs <report.md>');
    process.exit(1);
  }

  const reportPath = resolve(args[0]);
  let content;
  try {
    content = await readFile(reportPath, 'utf-8');
  } catch {
    console.error(`Cannot read file: ${reportPath}`);
    process.exit(1);
  }

  // Extract raw score and hard_stops from the Machine Summary YAML block
  const yamlMatch = content.match(/```yaml\n([\s\S]+?)```/);
  if (!yamlMatch) {
    console.error('No YAML block found in report.');
    process.exit(1);
  }

  const yaml = yamlMatch[1];

  // Parse score
  const scoreMatch = yaml.match(/^score:\s*([\d.]+)/m);
  if (!scoreMatch) {
    console.error('No score field found in YAML.');
    process.exit(1);
  }
  const aiScore = parseFloat(scoreMatch[1]);

  // Parse hard_stops array
  const hardStopsSection = yaml.match(/hard_stops:\s*\n((?:\s+- .+\n?)*)/);
  let hardStops = [];
  if (hardStopsSection) {
    hardStops = hardStopsSection[1]
      .split('\n')
      .map(l => l.replace(/^\s+- /, '').trim())
      .filter(l => l && l !== '[]' && l !== '');
  }

  // Parse soft_gaps
  const softGapsSection = yaml.match(/soft_gaps:\s*\n((?:\s+- .+\n?)*)/);
  let softGaps = [];
  if (softGapsSection) {
    softGaps = softGapsSection[1]
      .split('\n')
      .map(l => l.replace(/^\s+- /, '').trim())
      .filter(l => l && l !== '[]' && l !== '');
  }

  // Detect domain-level hard stops from keywords in hard_stops text
  const domainKeywords = [
    'haskell', 'rust', 'golang', 'go lang', '.net', 'c++', 'scala', 'erlang',
    'embedded', 'firmware', 'hardware', 'fpga', 'game engine', 'unity', 'unreal',
    'active-active', 'multi-dc', 'multi-region', 'lsm', 'distributed database',
    'event sourcing', 'functional programming', 'first principles distributed',
    'mainframe', 'cobol', 'sap', 'oracle ebs', 'salesforce development'
  ];

  const stackKeywords = [
    'jenkins', 'azure', 'gcp', 'google cloud', 'ansible tower', 'puppet', 'chef',
    'openshift', 'rancher', 'nomad', 'consul'
  ];

  const allGapText = [...hardStops, ...softGaps].join(' ').toLowerCase();

  const hasDomainMismatch = domainKeywords.some(k => allGapText.includes(k));
  const hardStopCount = hardStops.filter(s => s !== '[]').length;

  // Apply hard cap rules
  let cap = 5.0;
  let capReason = 'No caps applied';

  if (hasDomainMismatch) {
    cap = Math.min(cap, 2.0);
    capReason = 'Domain/language mismatch cap (2.0): core technology not in cv.md';
  } else if (hardStopCount >= 2) {
    cap = Math.min(cap, 2.5);
    capReason = `2+ hard stops cap (2.5): ${hardStopCount} hard blockers identified`;
  } else if (hardStopCount === 1) {
    cap = Math.min(cap, 3.5);
    capReason = `1 hard stop cap (3.5): ${hardStops[0]}`;
  }

  // Global score cannot exceed Match + 0.5 — approximated here:
  // If AI gave >4.0 but there are hard stops, something is wrong — clamp
  if (aiScore > 4.0 && hardStopCount > 0) {
    cap = Math.min(cap, 3.5);
    capReason += ' | AI score >4.0 with hard stops: clamped to 3.5';
  }

  const finalScore = Math.min(aiScore, cap);
  const adjusted = finalScore !== aiScore;

  // Determine final_decision based on final score
  let finalDecision;
  if (finalScore >= 4.0) finalDecision = 'Apply';
  else if (finalScore >= 3.0) finalDecision = 'Consider';
  else if (finalScore >= 2.0) finalDecision = 'Research first';
  else finalDecision = 'Skip';

  // Rewrite score in YAML block
  let newContent = content
    .replace(/^score:\s*[\d.]+/m, `score: ${finalScore.toFixed(1)}`)
    .replace(/^final_decision:\s*.+/m, `final_decision: "${finalDecision}"`);

  // Rewrite score in report header (** Score: X/5 **)
  newContent = newContent.replace(/\*\*Score:\*\*\s*[\d.]+\/5/, `**Score:** ${finalScore.toFixed(1)}/5`);

  // Add calculator note after YAML block
  const calcNote = `\n> **Score recalculated by score-calculator.mjs:** AI score was ${aiScore.toFixed(1)} → final ${finalScore.toFixed(1)}. ${capReason}. Hard stops: ${hardStopCount}. Decision: ${finalDecision}.\n`;
  newContent = newContent.replace(/(```\s*\n)(##\s*A\))/m, `$1${calcNote}\n$2`);

  await writeFile(reportPath, newContent, 'utf-8');

  // Output JSON for orchestrator
  const result = {
    report: reportPath,
    ai_score: aiScore,
    final_score: parseFloat(finalScore.toFixed(1)),
    adjusted,
    cap_applied: cap < 5.0 ? cap : null,
    cap_reason: capReason,
    hard_stop_count: hardStopCount,
    domain_mismatch: hasDomainMismatch,
    final_decision: finalDecision
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error('score-calculator error:', err.message);
  process.exit(1);
});
