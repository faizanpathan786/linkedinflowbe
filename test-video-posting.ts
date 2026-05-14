/**
 * Integration Test for Video Posting Functionality
 *
 * Run this with: npx ts-node test-video-posting.ts
 *
 * Prerequisites:
 * 1. Backend server running (npm run dev)
 * 2. Database connected
 * 3. LinkedIn token configured (if testing actual LinkedIn posting)
 * 4. Environment variables set (.env file)
 */

import axios, { AxiosInstance } from 'axios';

// Configuration
const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || 'test-token'; // Get from your session

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  error?: string;
  responseData?: any;
}

class VideoPostingTester {
  private api: AxiosInstance;
  private results: TestResult[] = [];

  constructor(baseURL: string, authToken: string) {
    this.api = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // Test 1: Get template endpoint
  async testGetTemplate(): Promise<void> {
    const test: TestResult = {
      name: 'GET /posts/import/template',
      passed: false,
      message: 'Should return CSV template with video_url column',
    };

    try {
      const response = await this.api.get('/posts/import/template');
      const data = response.data;

      // Verify columns
      if (!data.columns.includes('video_url')) {
        throw new Error('Missing video_url column');
      }
      if (!data.columns.includes('image_url')) {
        throw new Error('Missing image_url column');
      }

      // Verify example rows
      const videoExample = data.example_rows.find(
        (row: any) => row.post_type === 'video'
      );
      if (!videoExample) {
        throw new Error('No video example in template');
      }

      test.passed = true;
      test.message = `✓ Template includes ${data.columns.length} columns`;
      test.responseData = {
        columns: data.columns,
        hasVideoExample: !!videoExample,
        notes: data.notes,
      };
    } catch (err: any) {
      test.error = err.message;
    }

    this.results.push(test);
  }

  // Test 2: Validate post_type=video requires video
  async testVideoValidation(): Promise<void> {
    const test: TestResult = {
      name: 'POST /posts - Validation',
      passed: false,
      message: 'Should reject post_type=video without video',
    };

    try {
      const response = await this.api.post('/posts', {
        content: 'Test video post',
        post_type: 'video',
        // No video_url or video_base64
      });

      test.error = `Should have failed but got ${response.status}`;
    } catch (err: any) {
      if (err.response?.status === 400) {
        const error = err.response.data.error;
        if (error.includes('video')) {
          test.passed = true;
          test.message = `✓ Correctly rejected: ${error}`;
          test.responseData = err.response.data;
        } else {
          test.error = `Wrong error message: ${error}`;
        }
      } else {
        test.error = `Unexpected status ${err.response?.status}: ${err.message}`;
      }
    }

    this.results.push(test);
  }

  // Test 3: Validate post_type=image requires image
  async testImageValidation(): Promise<void> {
    const test: TestResult = {
      name: 'POST /posts - Image Validation',
      passed: false,
      message: 'Should reject post_type=image without image',
    };

    try {
      const response = await this.api.post('/posts', {
        content: 'Test image post',
        post_type: 'image',
        // No image_base64
      });

      test.error = `Should have failed but got ${response.status}`;
    } catch (err: any) {
      if (err.response?.status === 400) {
        const error = err.response.data.error;
        if (error.includes('image')) {
          test.passed = true;
          test.message = `✓ Correctly rejected: ${error}`;
        } else {
          test.error = `Wrong error message: ${error}`;
        }
      }
    }

    this.results.push(test);
  }

  // Test 4: Create video post with valid URL
  async testCreateVideoPost(): Promise<void> {
    const test: TestResult = {
      name: 'POST /posts - Create Video Post',
      passed: false,
      message: 'Should create video post with valid video_url',
    };

    try {
      const response = await this.api.post('/posts', {
        content: 'Testing video post functionality',
        post_type: 'video',
        video_url: 'https://www.w3schools.com/html/mov_bbb.mp4',
        scheduled_at: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      });

      if (response.status === 201) {
        const post = response.data.post;
        if (post.has_video) {
          test.passed = true;
          test.message = `✓ Created video post (ID: ${post.id})`;
          test.responseData = {
            postId: post.id,
            hasVideo: post.has_video,
            status: post.status,
            videoUrl: post.video_url,
          };
        } else {
          test.error = 'Post created but has_video is false';
        }
      } else {
        test.error = `Unexpected status: ${response.status}`;
      }
    } catch (err: any) {
      test.error = err.response?.data?.message || err.message;
    }

    this.results.push(test);
  }

  // Test 5: Bulk create with video
  async testBulkCreateWithVideo(): Promise<void> {
    const test: TestResult = {
      name: 'POST /posts/bulk - Video Support',
      passed: false,
      message: 'Should create multiple posts including video',
    };

    try {
      const response = await this.api.post('/posts/bulk', {
        posts: [
          {
            content: 'Regular text post',
            post_type: 'text',
          },
          {
            content: 'Post with video',
            post_type: 'video',
            video_url: 'https://www.w3schools.com/html/mov_bbb.mp4',
            scheduled_at: new Date(Date.now() + 7200000).toISOString(),
          },
        ],
      });

      if (response.status === 201 && response.data.created === 2) {
        test.passed = true;
        test.message = `✓ Created ${response.data.created} posts`;
        test.responseData = {
          created: response.data.created,
          failed: response.data.failed,
          totalRequested: 2,
        };
      } else {
        test.error = `Expected 2 posts, got ${response.data.created}`;
      }
    } catch (err: any) {
      test.error = err.response?.data?.message || err.message;
    }

    this.results.push(test);
  }

  // Test 6: Invalid video URL error handling
  async testInvalidVideoUrl(): Promise<void> {
    const test: TestResult = {
      name: 'POST /posts - Invalid Video URL',
      passed: false,
      message: 'Should handle invalid video URLs gracefully',
    };

    try {
      const response = await this.api.post('/posts', {
        content: 'Post with invalid video',
        post_type: 'video',
        video_url: 'https://example.com/nonexistent-video-that-does-not-exist.mp4',
      });

      test.error = `Should have failed but got ${response.status}`;
    } catch (err: any) {
      if (err.response?.status === 400) {
        const message = err.response.data.message;
        if (message && (message.includes('404') || message.includes('download'))) {
          test.passed = true;
          test.message = `✓ Correctly handled invalid URL: ${message.substring(0, 80)}...`;
        } else {
          test.error = `Got error but unexpected message: ${message}`;
        }
      } else {
        test.error = `Unexpected status ${err.response?.status}`;
      }
    }

    this.results.push(test);
  }

  // Test 7: Authorization required
  async testAuthRequired(): Promise<void> {
    const test: TestResult = {
      name: 'Authorization Required',
      passed: false,
      message: 'Should reject requests without auth token',
    };

    try {
      const noAuthApi = axios.create({
        baseURL: API_BASE_URL,
      });

      const response = await noAuthApi.get('/posts/import/template');
      test.error = `Should have failed but got ${response.status}`;
    } catch (err: any) {
      if (err.response?.status === 401) {
        test.passed = true;
        test.message = '✓ Correctly requires authorization';
      } else {
        test.error = `Unexpected status ${err.response?.status}`;
      }
    }

    this.results.push(test);
  }

  // Test 8: POST /posts/import/template notes
  async testTemplateNotes(): Promise<void> {
    const test: TestResult = {
      name: 'Template Includes Instructions',
      passed: false,
      message: 'Should include helpful notes about video URLs',
    };

    try {
      const response = await this.api.get('/posts/import/template');
      const data = response.data;

      if (data.notes && data.notes.includes('publicly accessible')) {
        test.passed = true;
        test.message = '✓ Template includes helpful guidance';
        test.responseData = { notes: data.notes };
      } else {
        test.error = 'Notes missing or incomplete';
      }
    } catch (err: any) {
      test.error = err.message;
    }

    this.results.push(test);
  }

  // Run all tests
  async runAll(): Promise<void> {
    console.log(`\n🎬 Video Posting Functionality Tests`);
    console.log(`📍 API: ${API_BASE_URL}`);
    console.log(`🔐 Auth: ${AUTH_TOKEN.substring(0, 20)}...`);
    console.log('─'.repeat(80));

    try {
      await this.testGetTemplate();
      await this.testVideoValidation();
      await this.testImageValidation();
      await this.testCreateVideoPost();
      await this.testBulkCreateWithVideo();
      await this.testInvalidVideoUrl();
      await this.testAuthRequired();
      await this.testTemplateNotes();
    } catch (err: any) {
      console.error('Unexpected test error:', err.message);
    }

    this.printResults();
  }

  // Print results
  private printResults(): void {
    console.log('\n📊 Test Results:');
    console.log('─'.repeat(80));

    const passed = this.results.filter((r) => r.passed).length;
    const total = this.results.length;

    this.results.forEach((result) => {
      const icon = result.passed ? '✅' : '❌';
      console.log(`\n${icon} ${result.name}`);
      console.log(`   ${result.message}`);

      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }

      if (result.responseData) {
        console.log(`   Data: ${JSON.stringify(result.responseData, null, 2)}`);
      }
    });

    console.log('\n' + '─'.repeat(80));
    console.log(`📈 Summary: ${passed}/${total} tests passed`);

    if (passed === total) {
      console.log('✨ All tests passed!');
    } else {
      console.log(`⚠️  ${total - passed} test(s) failed`);
      process.exit(1);
    }
  }
}

// Main execution
async function main() {
  const tester = new VideoPostingTester(API_BASE_URL, AUTH_TOKEN);
  await tester.runAll();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
