export interface ContentFeatures {
  length: number;
  hashtags: number;
  mentions: number;
  lines: number;
  avgLineLength: number;
  toneScore: number;
  wordVariety: number;
  hasEmoji: boolean;
  hasQuestion: boolean;
  hasCallToAction: boolean;
  readabilityScore: number;
}

export class FeatureExtractor {
  static extractFeatures(content: string): ContentFeatures {
    const length = content.length;
    const hashtags = (content.match(/#\w+/g) || []).length;
    const mentions = (content.match(/@\w+/g) || []).length;
    const lines = content.split('\n').length;
    const avgLineLength = length / lines;

    // Tone analysis (simple heuristic)
    const positiveWords = ['great', 'amazing', 'love', 'excellent', 'best', 'awesome', 'fantastic', 'wonderful', 'incredible'];
    const negativeWords = ['hate', 'bad', 'worst', 'terrible', 'awful', 'horrible', 'poor', 'fail', 'wrong'];

    const posCount = positiveWords.filter(w => content.toLowerCase().includes(w)).length;
    const negCount = negativeWords.filter(w => content.toLowerCase().includes(w)).length;
    const toneScore = (posCount - negCount) / (posCount + negCount + 1);

    // Word variety
    const words = content.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words).size;
    const wordVariety = uniqueWords / words.length;

    // Readability (simplified)
    const avgSentenceLength = length / (content.split(/[.!?]+/).length || 1);
    const readabilityScore = Math.max(0, 100 - avgSentenceLength * 1.5);

    return {
      length,
      hashtags,
      mentions,
      lines,
      avgLineLength,
      toneScore,
      wordVariety,
      hasEmoji: /[\uD800-\uDBFF]|[\uDC00-\uDFFF]/.test(content),
      hasQuestion: content.includes('?'),
      hasCallToAction: /comment|share|reply|let me know|drop a|your thoughts/i.test(content),
      readabilityScore,
    };
  }
}
