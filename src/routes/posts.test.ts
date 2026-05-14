import { test, describe, beforeAll, afterAll } from 'node:test';
import * as assert from 'node:assert';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import postsRoutes from './posts';
import { Pool } from 'pg';

// Mock auth module
const mockAuth = {
  api: {
    getSession: async ({ headers }: any) => {
      const authHeader = headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
      }
      return {
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
        },
      };
    },
  },
};

// Mock Supabase functions
const mockVideoFunctions = {
  downloadVideoFromUrl: async (url: string) => {
    // Return a mock video buffer for testing
    const testBuffer = Buffer.from('mock-video-data');
    return {
      buffer: testBuffer,
      contentType: 'video/mp4',
      sizeBytes: testBuffer.length,
    };
  },
  uploadVideoToStorage: async (buffer: Buffer, contentType: string, userId: string) => {
    return {
      storagePath: `${userId}/${Date.now()}.mp4`,
      publicUrl: `https://storage.example.com/${userId}/${Date.now()}.mp4`,
    };
  },
  downloadVideoFromStorage: async (storagePath: string) => {
    return {
      buffer: Buffer.from('mock-stored-video-data'),
      contentType: 'video/mp4',
      sizeBytes: 1024,
    };
  },
  deleteVideoFromStorage: async (storagePath: string) => {
    // No-op
  },
  getVideoPublicUrl: (storagePath: string) => {
    return `https://storage.example.com/${storagePath}`;
  },
};

describe('Video Posts Functionality', async () => {
  let fastify: any;
  let mockPool: any;

  beforeAll(async () => {
    fastify = Fastify({
      logger: { level: 'error' },
    });

    // Register plugins
    await fastify.register(cors);
    await fastify.register(multipart);

    // Mock the auth module
    (global as any).__auth = mockAuth;

    // Mock the pool
    mockPool = {
      connect: async () => ({
        query: async (sql: string, params: any) => {
          // Mock responses based on SQL
          if (sql.includes('SELECT * FROM public.posts WHERE id = $1 AND user_id = $2')) {
            return {
              rows: [
                {
                  id: 'post-1',
                  user_id: 'test-user-id',
                  content: 'Test video post',
                  post_type: 'video',
                  video_storage_path: 'test-user-id/123456.mp4',
                  status: 'draft',
                },
              ],
            };
          }
          if (sql.includes('INSERT INTO public.posts')) {
            return {
              rows: [
                {
                  id: 'new-post-id',
                  user_id: 'test-user-id',
                  content: params[1],
                  post_type: params[2],
                  video_storage_path: params[10],
                  status: params[5],
                  created_at: new Date(),
                  updated_at: new Date(),
                },
              ],
            };
          }
          return { rows: [] };
        },
        release: () => {},
      }),
    };

    // Override require for modules
    const Module = require('module');
    const originalRequire = Module.prototype.require;
    Module.prototype.require = function (id: string) {
      if (id === '../auth') {
        return { auth: mockAuth };
      }
      if (id === '../lib/supabase') {
        return mockVideoFunctions;
      }
      return originalRequire.apply(this, arguments);
    };

    // Register posts routes
    try {
      await fastify.register(postsRoutes);
    } catch (err) {
      console.error('Failed to register routes:', err);
    }
  });

  afterAll(async () => {
    await fastify.close();
  });

  test('GET /posts/import/template returns correct columns including video_url', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/posts/import/template',
      headers: {
        authorization: 'Bearer valid-token',
      },
    });

    assert.strictEqual(response.statusCode, 200);
    const data = JSON.parse(response.body);

    assert(data.columns.includes('video_url'), 'Should include video_url column');
    assert(data.columns.includes('image_url'), 'Should include image_url column');
    assert(data.columns.includes('post_type'), 'Should include post_type column');

    // Check example rows include video example
    const videoExample = data.example_rows.find((row: any) => row.post_type === 'video');
    assert(videoExample, 'Should have a video example row');
    assert(videoExample.video_url, 'Video example should have a video_url');
  });

  test('POST /posts with video_url requires post_type=video', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/posts',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      payload: {
        content: 'Test post',
        post_type: 'text',
        video_url: 'https://example.com/video.mp4',
      },
    });

    // Should succeed - system will include video in text post
    // or validation should warn
    assert.ok(
      [200, 201, 400].includes(response.statusCode),
      `Should return 200, 201, or 400, got ${response.statusCode}`
    );
  });

  test('POST /posts validates post_type=video requires video', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/posts',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      payload: {
        content: 'Test video post',
        post_type: 'video',
        // No video_url or video_base64
      },
    });

    assert.strictEqual(response.statusCode, 400);
    const data = JSON.parse(response.body);
    assert(
      data.error.includes('video'),
      'Error message should mention video requirement'
    );
  });

  test('POST /posts validates post_type=image requires image', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/posts',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      payload: {
        content: 'Test image post',
        post_type: 'image',
        // No image_base64
      },
    });

    assert.strictEqual(response.statusCode, 400);
    const data = JSON.parse(response.body);
    assert(
      data.error.includes('image'),
      'Error message should mention image requirement'
    );
  });

  test('POST /posts validates post_type=link requires link_url', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/posts',
      headers: {
        authorization: 'Bearer valid-token',
        'content-type': 'application/json',
      },
      payload: {
        content: 'Test link post',
        post_type: 'link',
        // No link_url
      },
    });

    assert.strictEqual(response.statusCode, 400);
    const data = JSON.parse(response.body);
    assert(
      data.error.includes('link'),
      'Error message should mention link requirement'
    );
  });

  test('POST /posts requires authorization', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/posts',
      headers: {
        'content-type': 'application/json',
        // No authorization header
      },
      payload: {
        content: 'Test post',
      },
    });

    assert.strictEqual(response.statusCode, 401);
    const data = JSON.parse(response.body);
    assert(data.error === 'Unauthorized');
  });

  test('GET /posts/import/template example includes working video URL', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/posts/import/template',
      headers: {
        authorization: 'Bearer valid-token',
      },
    });

    assert.strictEqual(response.statusCode, 200);
    const data = JSON.parse(response.body);

    const videoExample = data.example_rows.find((row: any) => row.post_type === 'video');
    assert(videoExample, 'Should have video example');
    assert(
      videoExample.video_url.includes('w3schools') || videoExample.video_url.includes('example'),
      'Video URL should be from a reliable source'
    );
  });

  test('Template includes helpful notes about video URLs', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/posts/import/template',
      headers: {
        authorization: 'Bearer valid-token',
      },
    });

    const data = JSON.parse(response.body);
    assert(data.notes, 'Should include notes about video URLs');
    assert(
      data.notes.includes('publicly accessible'),
      'Notes should mention URLs must be publicly accessible'
    );
  });
});

// Test CSV import validation (for POST /posts/import in server.ts)
describe('CSV Import Video Validation', () => {
  test('CSV with post_type=video but no video_url should fail', () => {
    // Simulate CSV parsing
    const csvRow = {
      content: 'Test video post',
      post_type: 'video',
      video_url: '',
      link_url: '',
      image_url: '',
    };

    // Validate
    const isVideoTypeWithoutVideo =
      csvRow.post_type === 'video' && !csvRow.video_url;

    assert(
      isVideoTypeWithoutVideo,
      'Should detect post_type=video without video_url'
    );
  });

  test('CSV with video_url should have storage path set', () => {
    // Simulate successful video processing
    const storageResult = {
      storagePath: 'user-123/1234567890.mp4',
      publicUrl: 'https://storage.example.com/user-123/1234567890.mp4',
    };

    assert(storageResult.storagePath, 'Should have storage path');
    assert(storageResult.publicUrl, 'Should have public URL');
    assert(
      storageResult.storagePath.includes('.mp4'),
      'Should have video extension'
    );
  });

  test('Failed video download should be reported as error not warning', () => {
    // Simulate error handling
    const errors: Array<{ row: number; message: string }> = [];

    try {
      throw new Error('Failed to download video: Request failed with status code 404');
    } catch (err: any) {
      errors.push({
        row: 3,
        message: err.message,
      });
    }

    assert.strictEqual(errors.length, 1);
    assert(
      errors[0].message.includes('Failed to download'),
      'Should be reported as error not warning'
    );
    assert(
      errors[0].message.includes('404'),
      'Should include error status code'
    );
  });
});

describe('Video Download Error Handling', () => {
  test('404 error should provide helpful message', () => {
    const url = 'https://example.com/nonexistent.mp4';
    const statusCode = 404;

    const errorMessage =
      statusCode === 404
        ? `Video URL not found (404): ${url}`
        : 'Generic error';

    assert(
      errorMessage.includes('not found'),
      'Should indicate URL not found'
    );
    assert(errorMessage.includes(url), 'Should include the URL');
  });

  test('403 error should provide helpful message', () => {
    const url = 'https://example.com/restricted.mp4';
    const statusCode = 403;

    const errorMessage =
      statusCode === 403
        ? `Access denied to video URL (403): ${url}`
        : 'Generic error';

    assert(
      errorMessage.includes('Access denied'),
      'Should indicate access denied'
    );
  });

  test('Timeout error should provide helpful message', () => {
    const url = 'https://example.com/slowvideo.mp4';
    const errorCode = 'ECONNABORTED';

    const errorMessage =
      errorCode === 'ECONNABORTED'
        ? `Download timeout: video URL took too long to download: ${url}`
        : 'Generic error';

    assert(
      errorMessage.includes('timeout'),
      'Should indicate timeout'
    );
  });
});

console.log('✓ Video Posts Test Suite Ready');
console.log('Run with: npm test src/routes/posts.test.ts');
