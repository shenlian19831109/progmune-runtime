// 计算两个字符串的简单 Jaccard 相似度（基于字符二元组）
export function jaccardSimilarity(a: string, b: string): number {
  const bigrams = (s: string) => {
    const bgs = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) bgs.add(s.substring(i, i+2));
    return bgs;
  };
  const setA = bigrams(a);
  const setB = bigrams(b);
  const intersection = new Set([...setA].filter(x => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / (union.size || 1);
}

// 从意图中提取关键词
export function extractKeywords(intent: string): string[] {
  return intent.split(/[\s，。！？,]+/).filter(w => w.length > 1).map(w => w.toLowerCase());
}
