import * as fs from 'fs';
import * as readline from 'readline';

interface Sequence {
  functionName: string;
  filePath: string;
  lineNumber: number;
  calls: string[];
  bodyLength: number;
}

interface LabeledData {
  metadata: any;
  labels: {
    index: number;
    label: 'clean' | 'violation' | 'skipped';
    functionName: string;
    calls: string[];
  }[];
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/label-sequences.ts <input.json> <output.json>');
    process.exit(1);
  }
  const inputFile = args[0];
  const outputFile = args[1];

  // 读取输入
  const raw = fs.readFileSync(inputFile, 'utf-8');
  const data = JSON.parse(raw);
  const sequences: Sequence[] = data.sequences || [];

  // 加载已有标注（如果存在）
  let labels: LabeledData['labels'] = [];
  let startIndex = 0;
  if (fs.existsSync(outputFile)) {
    const existing = JSON.parse(fs.readFileSync(outputFile, 'utf-8'));
    labels = existing.labels || [];
    startIndex = labels.length;
    console.log(`Loaded ${labels.length} existing labels. Resuming from index ${startIndex}.`);
  }

  console.log(`Total sequences: ${sequences.length}`);
  console.log('Commands: c = clean, v = violation, s = skip, q = quit');
  console.log('----------------------------------------');

  for (let i = startIndex; i < sequences.length; i++) {
    const seq = sequences[i];
    // 如果函数名是控制流关键字，自动跳过
    const controlKeywords = ['if', 'for', 'while', 'switch', 'return', 'sizeof', 'typeof', 'print', 'assert', 'raise'];
    if (controlKeywords.includes(seq.functionName)) {
      labels.push({ index: i, label: 'skipped', functionName: seq.functionName, calls: seq.calls });
      continue;
    }

    console.log(`\n[${i+1}/${sequences.length}] Function: ${seq.functionName} (${seq.filePath}:${seq.lineNumber})`);
    console.log(`  Calls: ${seq.calls.join(', ')}`);
    console.log(`  Body length: ${seq.bodyLength} lines`);

    let answer = '';
    while (true) {
      const input = await askQuestion('Label (c/v/s/q): ');
      answer = input.trim().toLowerCase();
      if (['c', 'v', 's', 'q'].includes(answer)) break;
      console.log('Invalid input. Please enter c, v, s, or q.');
    }

    if (answer === 'q') {
      console.log('Saving progress...');
      break;
    }

    const label = answer === 'c' ? 'clean' : answer === 'v' ? 'violation' : 'skipped';
    labels.push({ index: i, label, functionName: seq.functionName, calls: seq.calls });
  }

  // 保存标注结果
  const output = {
    metadata: {
      source: inputFile,
      labeledAt: new Date().toISOString(),
      totalSequences: sequences.length,
      labeled: labels.length,
    },
    labels,
  };
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
  console.log(`\n✅ Saved ${labels.length} labels to ${outputFile}`);
  rl.close();
}

main().catch(console.error);
