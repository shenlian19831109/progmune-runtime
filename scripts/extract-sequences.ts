import * as fs from 'fs';
import * as path from 'path';
import { extractSequences } from '../src/sequence-extractor';

async function main() {
  const args = process.argv.slice(2);
  const repoPath = args[0] || '.';
  const outputFile = args[1] || 'sequences.json';

  if (!fs.existsSync(repoPath)) {
    console.error(`Error: Path "${repoPath}" does not exist.`);
    process.exit(1);
  }

  console.log(`Extracting sequences from ${repoPath}...`);

  const sequences = extractSequences(repoPath, {
    include: /\.(c|h|ts|js|py)$/,
    exclude: /(test|vendor|node_modules|build|dist|\.git|__pycache__)/,
    maxBodyLines: 200,
    useCflow: false,
  });

  console.log(`Found ${sequences.length} function sequences.`);

  if (sequences.length === 0) {
    console.warn('No sequences found. Try a different path or check file extensions.');
    process.exit(1);
  }

  const stats = {
    total: sequences.length,
    avgCalls: sequences.reduce((sum, s) => sum + s.calls.length, 0) / sequences.length,
    maxCalls: Math.max(...sequences.map(s => s.calls.length)),
    files: new Set(sequences.map(s => s.filePath)).size,
  };

  console.log(`  - Files: ${stats.files}`);
  console.log(`  - Avg calls/function: ${stats.avgCalls.toFixed(1)}`);
  console.log(`  - Max calls: ${stats.maxCalls}`);

  const output = {
    metadata: {
      repo: repoPath,
      extractedAt: new Date().toISOString(),
      stats,
    },
    sequences,
  };

  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`Saved to ${outputFile}`);
}

main().catch(console.error);
