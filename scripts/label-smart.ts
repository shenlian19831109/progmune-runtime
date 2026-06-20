import * as fs from 'fs';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const args = process.argv.slice(2);
const inputFile = args[0];
const outputFile = args[1];

if (!inputFile || !outputFile) {
  console.error('Usage: npx tsx scripts/label-smart.ts <input.json> <output.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
const sequences = data.sequences;

// 控制流关键字列表
const controlKeywords = new Set([
  'if', 'for', 'while', 'switch', 'return', 'break', 'continue',
  'else', 'do', 'case', 'default', 'goto'
]);

// 过滤：只保留非控制流关键字的条目
const filtered = sequences.filter(s => !controlKeywords.has(s.functionName));

console.log(`Total sequences: ${sequences.length}`);
console.log(`Filtered to: ${filtered.length} (${sequences.length - filtered.length} skipped as control flow)`);

// 加载已有标签
const labels: Record<number, 'clean' | 'violation' | 'skip'> = {};
if (fs.existsSync(outputFile)) {
  const existing = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
  for (const key in existing) {
    labels[Number(key)] = existing[key];
  }
  console.log(`Loaded ${Object.keys(labels).length} existing labels.`);
}

// 建立原始索引到过滤后索引的映射
const originalIndices = filtered.map(s => sequences.indexOf(s));

// 只显示过滤后的条目
let idx = 0;
function promptNext() {
  while (idx < filtered.length && labels[originalIndices[idx]] !== undefined) idx++;
  if (idx >= filtered.length) {
    console.log('All filtered sequences labeled.');
    fs.writeFileSync(outputFile, JSON.stringify(labels, null, 2));
    console.log(`Saved labels to ${outputFile}`);
    rl.close();
    return;
  }
  const seq = filtered[idx];
  const origIdx = originalIndices[idx];
  console.log(`\n[${idx+1}/${filtered.length}] ${seq.functionName} (${seq.filePath})`);
  console.log(`  Calls: ${seq.calls.join(', ')}`);
  rl.question('c=clean, v=violation, s=skip, q=quit: ', (answer) => {
    if (answer === 'q') {
      fs.writeFileSync(outputFile, JSON.stringify(labels, null, 2));
      console.log(`Saved progress to ${outputFile}`);
      rl.close();
      return;
    }
    if (answer === 'c' || answer === 'v' || answer === 's') {
      labels[origIdx] = answer;
      idx++;
      promptNext();
    } else {
      console.log('Invalid input. Please enter c, v, s, or q.');
      promptNext();
    }
  });
}

console.log('Interactive labeling (only non-control-flow entries).');
promptNext();
