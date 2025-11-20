/**
 * Accuracy Test Queries
 *
 * Comprehensive set of 100+ queries with ground truth for accuracy testing.
 * Organized by category to measure different search capabilities.
 */

import { type AccuracyQuery } from './accuracy-test-runner';

/**
 * Function search queries (20 queries)
 * Tests ability to find specific functions by name or description
 */
export const functionSearchQueries: AccuracyQuery[] = [
  {
    query: 'find user authentication function',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/auth/authenticate.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'search for password hashing',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/auth/hash.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'locate database connection function',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/database/client.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'find email sending function',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/email/sender.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'search for file upload handler',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/upload/handler.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'find validation logic',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/validation/validator.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'search for JWT token generation',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/auth/jwt.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'locate error handler middleware',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/middleware/error.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'find rate limiting implementation',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/middleware/rate-limit.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'search for caching logic',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/cache/manager.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'find logging utility',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/utils/logger.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for configuration loader',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/config/env.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate payment processing',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/payment/processor.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'find webhook handler',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/webhook/handler.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'search for background job processing',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/jobs/processor.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'find CSV export function',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/export/csv.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'search for PDF generation',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/pdf/generator.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'locate image resizing',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/image/resize.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'find session management',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/session/manager.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'search for CORS configuration',
    category: 'function-search',
    expectedResults: [{ filePath: 'src/middleware/cors.ts', shouldBeInTopN: 5 }],
  },
];

/**
 * Symbol resolution queries (15 queries)
 * Tests ability to resolve symbol definitions
 */
export const symbolResolutionQueries: AccuracyQuery[] = [
  {
    query: 'find User class definition',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/models/user.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for Product interface',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/product.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate OrderStatus enum',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/order.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find UserRepository class',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/repositories/user.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for AuthService',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/services/auth.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate DatabaseConfig interface',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/config.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find EmailTemplate type',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/email.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for PaymentMethod enum',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/payment.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate ApiError class',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/errors/api-error.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find Logger interface',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/logger.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for ValidationError',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/errors/validation.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate HttpMethod type',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/http.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find CacheOptions interface',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/cache.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for WebhookEvent type',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/webhook.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate JobStatus enum',
    category: 'symbol-resolution',
    expectedResults: [{ filePath: 'src/types/job.ts', shouldBeInTopN: 3 }],
  },
];

/**
 * Cross-file dependency queries (15 queries)
 * Tests import chain expansion and dependency resolution
 */
export const dependencyQueries: AccuracyQuery[] = [
  {
    query: 'find all files that import User model',
    category: 'cross-file-dependencies',
    expectedResults: [
      { filePath: 'src/services/user.ts' },
      { filePath: 'src/controllers/user.ts' },
      { filePath: 'src/repositories/user.ts' },
    ],
  },
  {
    query: 'search for files using AuthService',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/controllers/auth.ts' }, { filePath: 'src/middleware/auth.ts' }],
  },
  {
    query: 'locate files importing database client',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/repositories/base.ts' }, { filePath: 'src/migrations/runner.ts' }],
  },
  {
    query: 'find files using logger utility',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/services/' }, { filePath: 'src/controllers/' }],
  },
  {
    query: 'search for files importing validation helpers',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/middleware/validate.ts' }, { filePath: 'src/services/' }],
  },
  {
    query: 'locate files using cache manager',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/services/' }, { filePath: 'src/repositories/' }],
  },
  {
    query: 'find files importing email sender',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/services/notification.ts' }, { filePath: 'src/jobs/email.ts' }],
  },
  {
    query: 'search for files using payment processor',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/services/order.ts' }, { filePath: 'src/controllers/payment.ts' }],
  },
  {
    query: 'locate files importing error classes',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/services/' }, { filePath: 'src/controllers/' }],
  },
  {
    query: 'find files using webhook handler',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/routes/webhook.ts' }, { filePath: 'src/services/webhook.ts' }],
  },
  {
    query: 'search for files importing job processor',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/queue/worker.ts' }, { filePath: 'src/services/background.ts' }],
  },
  {
    query: 'locate files using PDF generator',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/services/report.ts' }, { filePath: 'src/controllers/export.ts' }],
  },
  {
    query: 'find files importing session manager',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/middleware/session.ts' }, { filePath: 'src/controllers/auth.ts' }],
  },
  {
    query: 'search for files using image resizer',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/services/upload.ts' }, { filePath: 'src/jobs/image.ts' }],
  },
  {
    query: 'locate files importing rate limiter',
    category: 'cross-file-dependencies',
    expectedResults: [{ filePath: 'src/middleware/rate-limit.ts' }, { filePath: 'src/routes/api.ts' }],
  },
];

/**
 * API endpoint queries (15 queries)
 * Tests API contract enrichment and endpoint discovery
 */
export const apiEndpointQueries: AccuracyQuery[] = [
  {
    query: 'find user registration endpoint',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/auth.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for login API',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/auth.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate user profile endpoint',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/user.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find product listing API',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/product.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for order creation endpoint',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/order.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate payment processing API',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/payment.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find file upload endpoint',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/upload.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for webhook receiver',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/webhook.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate export data API',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/export.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find search endpoint',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/search.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for notification API',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/notification.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate analytics endpoint',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/analytics.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find health check API',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/health.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for admin endpoints',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/routes/admin.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate GraphQL schema',
    category: 'api-endpoints',
    expectedResults: [{ filePath: 'src/graphql/schema.ts', shouldBeInTopN: 3 }],
  },
];

/**
 * Configuration and setup queries (10 queries)
 * Tests ability to find config files and setup code
 */
export const configurationQueries: AccuracyQuery[] = [
  {
    query: 'find database configuration',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/database.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for environment variables setup',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/env.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate Redis configuration',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/redis.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find email service config',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/email.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for AWS S3 setup',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/aws.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate payment gateway config',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/payment.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find logging configuration',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/logger.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for CORS settings',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/cors.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate rate limit config',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/rate-limit.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find application constants',
    category: 'configuration',
    expectedResults: [{ filePath: 'src/config/constants.ts', shouldBeInTopN: 3 }],
  },
];

/**
 * Error handling queries (10 queries)
 * Tests ability to find error handling code
 */
export const errorHandlingQueries: AccuracyQuery[] = [
  {
    query: 'find global error handler',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/middleware/error.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for validation error handling',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/errors/validation.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate API error class',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/errors/api-error.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find database error handling',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/errors/database.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for authentication errors',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/errors/auth.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate not found error',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/errors/not-found.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find permission error',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/errors/permission.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'search for payment error handling',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/errors/payment.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'locate rate limit error',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/errors/rate-limit.ts', shouldBeInTopN: 3 }],
  },
  {
    query: 'find server error handler',
    category: 'error-handling',
    expectedResults: [{ filePath: 'src/errors/server.ts', shouldBeInTopN: 3 }],
  },
];

/**
 * Testing and utilities queries (10 queries)
 * Tests ability to find test files and utility functions
 */
export const testingQueries: AccuracyQuery[] = [
  {
    query: 'find test helper functions',
    category: 'testing',
    expectedResults: [{ filePath: 'tests/helpers/' }],
  },
  {
    query: 'search for mock data generators',
    category: 'testing',
    expectedResults: [{ filePath: 'tests/fixtures/' }],
  },
  {
    query: 'locate database test setup',
    category: 'testing',
    expectedResults: [{ filePath: 'tests/helpers/db-setup.ts', shouldBeInTopN: 5 }],
  },
  {
    query: 'find authentication tests',
    category: 'testing',
    expectedResults: [{ filePath: 'tests/auth.test.ts' }],
  },
  {
    query: 'search for API endpoint tests',
    category: 'testing',
    expectedResults: [{ filePath: 'tests/api/' }],
  },
  {
    query: 'locate utility function tests',
    category: 'testing',
    expectedResults: [{ filePath: 'tests/utils/' }],
  },
  {
    query: 'find integration test setup',
    category: 'testing',
    expectedResults: [{ filePath: 'tests/integration/' }],
  },
  {
    query: 'search for E2E test scenarios',
    category: 'testing',
    expectedResults: [{ filePath: 'tests/e2e/' }],
  },
  {
    query: 'locate performance test utilities',
    category: 'testing',
    expectedResults: [{ filePath: 'tests/scale/' }],
  },
  {
    query: 'find test coverage configuration',
    category: 'testing',
    expectedResults: [{ filePath: 'jest.config.js', shouldBeInTopN: 5 }],
  },
];

/**
 * All accuracy queries (100+ queries across 7 categories)
 */
export const allAccuracyQueries: AccuracyQuery[] = [
  ...functionSearchQueries,
  ...symbolResolutionQueries,
  ...dependencyQueries,
  ...apiEndpointQueries,
  ...configurationQueries,
  ...errorHandlingQueries,
  ...testingQueries,
];
