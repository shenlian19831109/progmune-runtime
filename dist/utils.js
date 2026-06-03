// 计算两个字符串的简单 Jaccard 相似度（基于字符二元组）
/** @requires STRING_A @produces SIMILARITY_SCORE */
export function jaccardSimilarity(a, b) {
    const bigrams = (s) => {
        const bgs = new Set();
        for (let i = 0; i < s.length - 1; i++)
            bgs.add(s.substring(i, i + 2));
        return bgs;
    };
    const setA = bigrams(a);
    const setB = bigrams(b);
    const intersection = new Set([...setA].filter(x => setB.has(x)));
    const union = new Set([...setA, ...setB]);
    return intersection.size / (union.size || 1);
}
// 从意图中提取关键词
/** @requires TEXT @produces KEYWORDS */
export function extractKeywords(intent) {
    return intent.split(/[\s，。！？,]+/).filter(w => w.length > 1).map(w => w.toLowerCase());
}
