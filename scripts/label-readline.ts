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
  console.error('Usage: npx tsx scripts/label-readline.ts <input.json> <output.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputFile, 'utf-8'));
const sequences = data.sequences;
const labels: Record<number, 'clean' | 'violation' | 'skip'> = {};

// 加载已有标签（如果存在）
if (fs.existsSync(outputFile)) {
  const existing = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
  for (const key in existing) {
    labels[Number(key)] = existing[key];
  }
  console.log(`Loaded ${Object.keys(labels).length} existing labels.`);
}

let idx = 0;
function promptNext() {
  // 找到第一个未标注的索引
  while (idx < sequences.length && labels[idx] !== undefined) idx++;
  if (idx >= sequences.length) {
    console.log('All sequences labeled.');
    fs.writeFileSync(outputFile, JSON.stringify(labels, null, 2));
    console.log(`Saved labels to ${outputFile}`);
    rl.close();
    return;
  }
  const seq = sequences[idx];
  console.log(`\n[${idx+1}/${sequences.length}] ${seq.functionName} (${seq.filePath})`);
  console.log(`  Calls: ${seq.calls.join(', ')}`);
  rl.question('c=clean, v=violation, s=skip, q=quit: ', (answer) => {
    if (answer === 'q') {
      fs.writeFileSync(outputFile, JSON.stringify(labels, null, 2));
      console.log(`Saved progress to ${outputFile}`);
      rl.close();
      return;
    }
    if (answer === 'c' || answer === 'v' || answer === 's') {
      labels[idx] = answer;
      idx++;
      promptNext();
    } else {
      console.log('Invalid input. Please enter c, v, s, or q.');
      promptNext();
    }
  });
}

console.log('Interactive labeling. Press c, v, s, or q.');
promptNext();
