# cindex Tests

This directory contains the test suite for the cindex MCP server.

## Directory Structure

```
tests/
├── unit/           # Unit tests (isolated component tests)
├── integration/    # Integration tests (database, Ollama, external services)
├── fixtures/       # Test data and mock files
└── helpers/        # Test utilities and setup scripts
```

## Running Tests

### Prerequisites

Before running tests, ensure you have:

1. PostgreSQL 16+ running with pgvector extension
2. Ollama running with at least one embedding model
3. Environment variables configured (see `.env.test`)

### Test Commands

```bash
# Run all tests
npm test

# Run unit tests only
npm test -- tests/unit

# Run integration tests only
npm test -- tests/integration

# Run with coverage
npm test -- --coverage

# Watch mode for development
npm test -- --watch
```

## Test Database

Integration tests use a separate test database: `cindex_rag_codebase_test`

The test helper automatically:
- Creates the test database if it doesn't exist
- Drops and recreates it before test suites
- Applies the schema from `database.sql`
- Cleans up after tests complete

**Important:** Never run tests against your production database!

## Environment Variables

Create a `.env.test` file for test configuration:

```bash
# Database
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password

# Ollama
OLLAMA_HOST=http://localhost:11434

# Test-specific
TEST_TIMEOUT=30000
```

## Writing Tests

### Unit Tests

Unit tests should:
- Test a single component in isolation
- Mock external dependencies (database, Ollama)
- Be fast (<100ms per test)
- Have no side effects

Example:
```typescript
import { describe, it, expect } from '@jest/globals';
import { loadConfig } from '@config/env';

describe('Configuration', () => {
  it('should load defaults', () => {
    const config = loadConfig();
    expect(config.embedding.dimensions).toBe(1024);
  });
});
```

### Integration Tests

Integration tests should:
- Test interactions with external services
- Use the test database (via `getTestDbClient`)
- Clean up after themselves
- Allow longer timeouts (10-30s)

Example:
```typescript
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { getTestDbClient, setupTestDatabase } from '../helpers/db-setup';

describe('Database Integration', () => {
  beforeAll(async () => {
    await setupTestDatabase();
  });

  it('should connect to database', async () => {
    const db = await getTestDbClient();
    expect(db.connected).toBe(true);
    await db.close();
  });
});
```

## Test Coverage

Aim for:
- **Unit tests:** >90% coverage for utilities, config, errors
- **Integration tests:** All external service interactions
- **E2E tests:** (Phase 5) Complete MCP tool workflows

## Troubleshooting

### "Database does not exist"

```bash
createdb cindex_rag_codebase_test
psql cindex_rag_codebase_test < database.sql
```

### "Ollama connection failed"

Ensure Ollama is running:
```bash
ollama serve
```

### "Model not found"

Pull the required models:
```bash
ollama pull bge-m3
ollama pull deepcoder:14b
```

### Test timeout

Increase timeout for slow operations:
```typescript
it('should generate embedding', async () => {
  // test code
}, 30000); // 30 second timeout
```
