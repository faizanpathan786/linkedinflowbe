import { FeatureExtractor, type ContentFeatures } from './feature-extractor';
import { Pool } from 'pg';

export interface UserAnalytics {
  best_posting_hour: number;
  best_posting_day: number;
  engagement_by_hour: Record<number, number>;
  engagement_by_day: Record<number, number>;
  avg_engagement_rate: number;
  avg_post_length: number;
  avg_hashtag_count: number;
  avg_tone_score: number;
}

export class MLService {
  static async predictPerformance(input: {
    features: ContentFeatures;
    userAnalytics: UserAnalytics;
    userHistory: any[];
    industryBenchmarks: any;
  }): Promise<{
    score: number;
    predictedLikes: number;
    predictedComments: number;
    breakdown: Record<string, number>;
  }> {
    const { features, userAnalytics, userHistory, industryBenchmarks } = input;

    // 1. Content quality score (40% weight)
    const contentScore = this.scoreContent(features) * 0.4;

    // 2. Historical performance score (40% weight)
    const historicalScore = this.scoreHistorical(features, userHistory, userAnalytics) * 0.4;

    // 3. Trend/industry score (20% weight)
    const trendScore = this.scoreTrends(features, industryBenchmarks) * 0.2;

    const totalScore = contentScore + historicalScore + trendScore;

    // Predict engagement numbers
    const baseEngagementPerPost = userAnalytics.avg_engagement_rate || 0.03;
    const engagementMultiplier = totalScore / 10;
    const predictedLikes = Math.round(baseEngagementPerPost * 1500 * engagementMultiplier);
    const predictedComments = Math.round(predictedLikes * 0.15);

    return {
      score: Math.min(10, Math.max(0, totalScore)),
      predictedLikes,
      predictedComments,
      breakdown: {
        length: this.scoreLength(features.length),
        hashtags: this.scoreHashtags(features.hashtags),
        keywords: features.wordVariety > 0.7 ? 8 : 6,
        tone: Math.min(10, (features.toneScore + 1) * 5),
        historical: historicalScore * 10,
        trend: trendScore * 10,
      },
    };
  }

  static async predictOptimalTime(input: {
    userAnalytics: UserAnalytics;
    dayOfWeek: number;
  }): Promise<{
    recommendedHour: number;
    recommendedDay: string;
    engagementLiftPercent: number;
    engagementPrediction: {
      ifPostedNow: number;
      ifPostedOptimal: number;
      potentialGain: number;
    };
  }> {
    const { userAnalytics, dayOfWeek } = input;

    const engagementByHour = userAnalytics.engagement_by_hour || {};

    let bestHour = 9;
    let maxEngagement = 0;
    for (const [hour, engagement] of Object.entries(engagementByHour)) {
      if ((engagement as number) > maxEngagement) {
        maxEngagement = engagement as number;
        bestHour = parseInt(hour);
      }
    }

    const avgEngagement = Object.values(engagementByHour).reduce((a: any, b: any) => a + b, 0) / 24;
    const engagementLift = avgEngagement > 0 ? ((maxEngagement - avgEngagement) / avgEngagement) * 100 : 0;

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    return {
      recommendedHour: bestHour,
      recommendedDay: dayNames[dayOfWeek],
      engagementLiftPercent: Math.round(Math.max(0, engagementLift)),
      engagementPrediction: {
        ifPostedNow: 35,
        ifPostedOptimal: Math.round(35 * (1 + engagementLift / 100)),
        potentialGain: Math.round(35 * (engagementLift / 100)),
      },
    };
  }

  private static scoreContent(features: ContentFeatures): number {
    let score = 5;

    if (features.length >= 100 && features.length <= 250) {
      score += 2;
    } else if (features.length < 50 || features.length > 300) {
      score -= 1;
    } else if (features.length >= 50 && features.length < 100) {
      score += 0.5;
    }

    if (features.hashtags >= 3 && features.hashtags <= 5) {
      score += 1.5;
    } else if (features.hashtags > 8) {
      score -= 1;
    } else if (features.hashtags === 0) {
      score -= 0.5;
    }

    if (features.toneScore > 0.3) {
      score += 1;
    } else if (features.toneScore < -0.3) {
      score -= 1;
    }

    if (features.hasCallToAction) {
      score += 1.5;
    }

    if (features.hasQuestion) {
      score += 0.8;
    }

    if (features.wordVariety > 0.8) {
      score += 0.5;
    } else if (features.wordVariety < 0.5) {
      score -= 0.5;
    }

    if (features.readabilityScore > 60) {
      score += 0.5;
    }

    return Math.min(10, Math.max(0, score));
  }

  private static scoreLength(length: number): number {
    if (length >= 100 && length <= 250) return 9;
    if (length >= 50 && length < 100) return 6;
    if (length > 250 && length <= 300) return 7;
    if (length > 300) return 5;
    return 3;
  }

  private static scoreHashtags(count: number): number {
    if (count >= 3 && count <= 5) return 9;
    if (count === 1 || count === 2) return 6;
    if (count === 6 || count === 7) return 7;
    if (count > 8) return 3;
    return 1;
  }

  private static scoreHistorical(
    features: ContentFeatures,
    userHistory: any[],
    userAnalytics: UserAnalytics
  ): number {
    if (!userHistory || userHistory.length < 5) {
      return 3;
    }

    const similarPosts = userHistory.filter((p) =>
      Math.abs((p.content_length || 0) - features.length) < 50 &&
      (p.hashtag_count || 0) === features.hashtags
    );

    if (similarPosts.length === 0) {
      return 3;
    }

    const avgEngagement = similarPosts.reduce(
      (sum, p) => sum + (p.final_like_count || 0),
      0
    ) / similarPosts.length;

    return Math.min(10, (avgEngagement / 50) * 10);
  }

  private static scoreTrends(features: ContentFeatures, benchmarks: any): number {
    let score = 5;

    if (benchmarks?.videoEngagementRate > benchmarks?.avgEngagementRate) {
      score += 1;
    }

    if (benchmarks?.trendingHashtagBoost) {
      score += 0.5;
    }

    return Math.min(10, score);
  }
}
