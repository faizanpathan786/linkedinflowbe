import { test, describe, beforeAll, afterAll } from 'node:test';
import * as assert from 'node:assert';
import axios, { AxiosInstance } from 'axios';

/**
 * Integration tests for Automation Settings API
 *
 * Run with: npm test src/routes/automation.test.ts
 *
 * Prerequisites:
 * - Backend server running on http://localhost:3000
 * - Database connection configured
 * - Valid test auth token in environment or hardcoded
 */

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TEST_AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || 'test-token';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  error?: string;
}

const results: TestResult[] = [];

function addResult(name: string, passed: boolean, message: string, error?: string) {
  results.push({ name, passed, message, error });
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}: ${message}`);
  if (error) console.log(`   Error: ${error}`);
}

describe('Automation Settings API', async () => {
  let api: AxiosInstance;

  beforeAll(async () => {
    api = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        Authorization: `Bearer ${TEST_AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true, // Don't throw on any status
    });
  });

  test('GET /api/automation/settings returns defaults for new user', async () => {
    try {
      const response = await api.get('/api/automation/settings');

      if (response.status === 200) {
        const settings = response.data.settings;
        assert.strictEqual(settings.autoRetry, true);
        assert.strictEqual(settings.retryAttempts, 3);
        assert.strictEqual(settings.delayBetweenPosts, 5);
        assert.strictEqual(settings.enableScheduling, true);
        assert.strictEqual(settings.maxDailyPosts, 10);

        addResult(
          'GET /api/automation/settings (defaults)',
          true,
          'Returns correct default settings'
        );
      } else {
        addResult(
          'GET /api/automation/settings (defaults)',
          false,
          `Expected 200, got ${response.status}`,
          JSON.stringify(response.data)
        );
      }
    } catch (err: any) {
      addResult(
        'GET /api/automation/settings (defaults)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  test('POST /api/automation/settings validates retryAttempts range', async () => {
    try {
      const response = await api.post('/api/automation/settings', {
        autoRetry: true,
        retryAttempts: 10, // Invalid: max is 5
        delayBetweenPosts: 5,
        enableScheduling: true,
        maxDailyPosts: 10,
      });

      if (response.status === 400) {
        assert(
          response.data.message.includes('Invalid'),
          'Should indicate invalid input'
        );
        addResult(
          'POST /api/automation/settings (validation)',
          true,
          'Correctly rejects invalid retryAttempts'
        );
      } else {
        addResult(
          'POST /api/automation/settings (validation)',
          false,
          `Expected 400, got ${response.status}`
        );
      }
    } catch (err: any) {
      addResult(
        'POST /api/automation/settings (validation)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  test('POST /api/automation/settings validates delayBetweenPosts range', async () => {
    try {
      const response = await api.post('/api/automation/settings', {
        autoRetry: true,
        retryAttempts: 3,
        delayBetweenPosts: 120, // Invalid: max is 60
        enableScheduling: true,
        maxDailyPosts: 10,
      });

      if (response.status === 400) {
        addResult(
          'POST /api/automation/settings (delay validation)',
          true,
          'Correctly rejects invalid delayBetweenPosts'
        );
      } else {
        addResult(
          'POST /api/automation/settings (delay validation)',
          false,
          `Expected 400, got ${response.status}`
        );
      }
    } catch (err: any) {
      addResult(
        'POST /api/automation/settings (delay validation)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  test('POST /api/automation/settings validates maxDailyPosts range', async () => {
    try {
      const response = await api.post('/api/automation/settings', {
        autoRetry: true,
        retryAttempts: 3,
        delayBetweenPosts: 5,
        enableScheduling: true,
        maxDailyPosts: 100, // Invalid: max is 50
      });

      if (response.status === 400) {
        addResult(
          'POST /api/automation/settings (maxDailyPosts validation)',
          true,
          'Correctly rejects invalid maxDailyPosts'
        );
      } else {
        addResult(
          'POST /api/automation/settings (maxDailyPosts validation)',
          false,
          `Expected 400, got ${response.status}`
        );
      }
    } catch (err: any) {
      addResult(
        'POST /api/automation/settings (maxDailyPosts validation)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  test('POST /api/automation/settings validates boolean fields', async () => {
    try {
      const response = await api.post('/api/automation/settings', {
        autoRetry: 'true', // Invalid: should be boolean
        retryAttempts: 3,
        delayBetweenPosts: 5,
        enableScheduling: true,
        maxDailyPosts: 10,
      });

      if (response.status === 400) {
        addResult(
          'POST /api/automation/settings (boolean validation)',
          true,
          'Correctly rejects non-boolean fields'
        );
      } else {
        addResult(
          'POST /api/automation/settings (boolean validation)',
          false,
          `Expected 400, got ${response.status}`
        );
      }
    } catch (err: any) {
      addResult(
        'POST /api/automation/settings (boolean validation)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  test('POST /api/automation/settings updates settings successfully', async () => {
    try {
      const newSettings = {
        autoRetry: false,
        retryAttempts: 1,
        delayBetweenPosts: 10,
        enableScheduling: false,
        maxDailyPosts: 20,
      };

      const response = await api.post('/api/automation/settings', newSettings);

      if (response.status === 200) {
        const settings = response.data.settings;
        assert.strictEqual(settings.autoRetry, false);
        assert.strictEqual(settings.retryAttempts, 1);
        assert.strictEqual(settings.delayBetweenPosts, 10);
        assert.strictEqual(settings.enableScheduling, false);
        assert.strictEqual(settings.maxDailyPosts, 20);

        addResult(
          'POST /api/automation/settings (update)',
          true,
          'Successfully updates settings'
        );
      } else {
        addResult(
          'POST /api/automation/settings (update)',
          false,
          `Expected 200, got ${response.status}`,
          JSON.stringify(response.data)
        );
      }
    } catch (err: any) {
      addResult(
        'POST /api/automation/settings (update)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  test('GET /api/automation/settings returns updated settings', async () => {
    try {
      const response = await api.get('/api/automation/settings');

      if (response.status === 200) {
        const settings = response.data.settings;
        // Should return the updated settings from previous test
        assert.strictEqual(settings.autoRetry, false);
        assert.strictEqual(settings.retryAttempts, 1);
        assert.strictEqual(settings.delayBetweenPosts, 10);
        assert.strictEqual(settings.enableScheduling, false);
        assert.strictEqual(settings.maxDailyPosts, 20);

        addResult(
          'GET /api/automation/settings (retrieve updated)',
          true,
          'Successfully retrieves updated settings'
        );
      } else {
        addResult(
          'GET /api/automation/settings (retrieve updated)',
          false,
          `Expected 200, got ${response.status}`
        );
      }
    } catch (err: any) {
      addResult(
        'GET /api/automation/settings (retrieve updated)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  test('POST /api/automation/settings requires authentication', async () => {
    try {
      const noAuthApi = axios.create({
        baseURL: API_BASE_URL,
        validateStatus: () => true,
      });

      const response = await noAuthApi.post('/api/automation/settings', {
        autoRetry: true,
        retryAttempts: 3,
        delayBetweenPosts: 5,
        enableScheduling: true,
        maxDailyPosts: 10,
      });

      if (response.status === 401) {
        assert.strictEqual(response.data.message, 'Unauthorized');
        addResult(
          'POST /api/automation/settings (auth required)',
          true,
          'Correctly requires authentication'
        );
      } else {
        addResult(
          'POST /api/automation/settings (auth required)',
          false,
          `Expected 401, got ${response.status}`
        );
      }
    } catch (err: any) {
      addResult(
        'POST /api/automation/settings (auth required)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  test('GET /api/automation/settings requires authentication', async () => {
    try {
      const noAuthApi = axios.create({
        baseURL: API_BASE_URL,
        validateStatus: () => true,
      });

      const response = await noAuthApi.get('/api/automation/settings');

      if (response.status === 401) {
        assert.strictEqual(response.data.message, 'Unauthorized');
        addResult(
          'GET /api/automation/settings (auth required)',
          true,
          'Correctly requires authentication'
        );
      } else {
        addResult(
          'GET /api/automation/settings (auth required)',
          false,
          `Expected 401, got ${response.status}`
        );
      }
    } catch (err: any) {
      addResult(
        'GET /api/automation/settings (auth required)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  test('POST /api/automation/settings accepts valid edge cases', async () => {
    try {
      const edgeCases = {
        autoRetry: true,
        retryAttempts: 5, // Max value
        delayBetweenPosts: 60, // Max value
        enableScheduling: true,
        maxDailyPosts: 50, // Max value
      };

      const response = await api.post('/api/automation/settings', edgeCases);

      if (response.status === 200) {
        const settings = response.data.settings;
        assert.strictEqual(settings.retryAttempts, 5);
        assert.strictEqual(settings.delayBetweenPosts, 60);
        assert.strictEqual(settings.maxDailyPosts, 50);

        addResult(
          'POST /api/automation/settings (edge cases)',
          true,
          'Accepts max valid values'
        );
      } else {
        addResult(
          'POST /api/automation/settings (edge cases)',
          false,
          `Expected 200, got ${response.status}`
        );
      }
    } catch (err: any) {
      addResult(
        'POST /api/automation/settings (edge cases)',
        false,
        'Request failed',
        err.message
      );
    }
  });

  afterAll(async () => {
    // Print summary
    console.log('\n' + '─'.repeat(80));
    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    console.log(`\n📊 Test Summary: ${passed}/${total} tests passed\n`);

    if (passed === total) {
      console.log('✨ All tests passed! Automation Settings API is working correctly.\n');
    } else {
      console.log(`⚠️  ${total - passed} test(s) failed\n`);
      process.exit(1);
    }
  });
});
