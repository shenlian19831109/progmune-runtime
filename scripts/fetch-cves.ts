import { fetchCVEsFromNVD } from '../src/cve-collector';
import * as fs from 'fs';
import * as path from 'path';

function categorizeCVE(cve: any): string {
  const text = (cve.description || '').toLowerCase();
  if (text.includes('resource') || text.includes('leak') || text.includes('memory')) return 'resource_leak';
  if (text.includes('auth') || text.includes('bypass') || text.includes('privilege')) return 'auth_bypass';
  if (text.includes('use after free') || text.includes('double free')) return 'use_after_free';
  if (text.includes('race') || text.includes('toctou')) return 'race_condition';
  if (text.includes('transaction') || text.includes('commit') || text.includes('rollback')) return 'transaction';
  if (text.includes('sql') || text.includes('injection')) return 'sql_injection';
  if (text.includes('xss') || text.includes('cross-site')) return 'xss';
  if (text.includes('rce') || text.includes('remote code')) return 'rce';
  if (text.includes('ssrf')) return 'ssrf';
  return 'other';
}

async function main() {
  console.log('Fetching CVE data from NVD...');
  const cves = await fetchCVEsFromNVD({ limit: 500, severity: 'HIGH' });
  console.log(`Fetched ${cves.length} CVEs.`);

  const shuffled = cves.sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, 100);

  const categorized = sample.map(cve => ({ ...cve, category: categorizeCVE(cve) }));
  const outputPath = path.join(__dirname, '../benchmarks/cve-100.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(categorized, null, 2));
  console.log(`Saved ${categorized.length} CVEs to ${outputPath}`);
}

main().catch(console.error);
