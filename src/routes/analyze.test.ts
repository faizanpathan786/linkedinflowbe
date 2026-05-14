import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FeatureExtractor } from '../services/feature-extractor';
import { MLService } from '../services/ml-service';

describe('Post Analysis', () => {
  it('should extract features from content', () => {
    const content = 'Here is what nobody talks about in AI. Amazing insights! #AI #Tech #Innovation';
    const features = FeatureExtractor.extractFeatures(content);

    assert.ok(features.length > 0);
    assert.equal(features.hashtags, 3);
    assert.equal(features.hasQuestion, false);
  });

  it('should score content', async () => {
    const content = 'Great post about AI! What do you think? #AI #ML #Tech';
    const features = FeatureExtractor.extractFeatures(content);

    const result = await MLService.predictPerformance({
      features,
      userAnalytics: {
        best_posting_hour: 9,
        best_posting_day: 2,
        engagement_by_hour: {},
        engagement_by_day: {},
        avg_engagement_rate: 0.03,
        avg_post_length: 150,
        avg_hashtag_count: 3,
        avg_tone_score: 0.2,
      },
      userHistory: [],
      industryBenchmarks: {
        videoEngagementRate: 0.08,
        avgEngagementRate: 0.03,
      },
    });

    assert.ok(result.score >= 0 && result.score <= 10);
    assert.ok(result.predictedLikes >= 0);
    assert.ok(result.predictedComments >= 0);
  });

  it('should predict optimal time', async () => {
    const result = await MLService.predictOptimalTime({
      userAnalytics: {
        best_posting_hour: 9,
        best_posting_day: 2,
        engagement_by_hour: { 9: 5.2, 10: 4.1 },
        engagement_by_day: {},
        avg_engagement_rate: 0.03,
        avg_post_length: 150,
        avg_hashtag_count: 3,
        avg_tone_score: 0.2,
      },
      dayOfWeek: 2,
    });

    assert.ok(result.recommendedHour >= 0 && result.recommendedHour < 24);
    assert.ok(result.recommendedDay);
    assert.ok(result.engagementLiftPercent >= 0);
  });
});
