# cindex - RAG MCP for Code Context

**Semantic code search and context retrieval for large codebases (1M+ LoC)**

**NPM Package:** `@gianged/cindex` **Author:** gianged **Project Type:** MCP Server for Claude Code
integration

---

## System Overview

Build a multi-stage retrieval system that progressively narrows from files → precise locations →
contextual code, optimized for Claude Code integration.

### Key Features

- **Semantic Code Search** - Vector embeddings for intelligent code discovery
- **Multi-Stage Retrieval** - Files → chunks → symbols → imports (4-stage pipeline)
- **Incremental Indexing** - Hash-based change detection planned (not yet fully implemented)
- **Configurable Models** - Swap embedding/LLM models via environment variables
- **Import Chain Analysis** - Automatic dependency resolution with depth limits
- **Deduplication** - Remove duplicate utility functions from results
- **Large Codebase Support** - Handles 1M+ lines of code efficiently
- **Claude Code Integration** - Native MCP server, plug-and-play with Claude
- **Accuracy-First Design** - Default settings optimized for relevance over speed
- **Flexible Database** - PostgreSQL with configurable connection parameters

### Supported Languages

TypeScript, JavaScript, Python, Java, Go, Rust, C, C++, and more via tree-sitter parsers.

**Tree-sitter Version:** 0.21.1 (Node.js bindings) **Language Parsers:** 0.21.x - 0.22.x (all
verified compatible) **API Reference:** See [docs/syntax.md](./syntax.md) for complete tree-sitter
API documentation

---

## 1. Data Model & Schema

**Database Schema:** See `database.sql` for complete schema definition.

**Note:** When using non-default `EMBEDDING_DIMENSIONS`, update the vector dimension in
`database.sql`:

```sql
-- Change all vector(1024) to match your EMBEDDING_DIMENSIONS
embedding vector(1024)  -- Change 1024 to your dimension
```

### Tables Overview

j **`code_chunks`** - Core embeddings table

- Stores embeddings for code chunks (functions, classes, blocks)
- Includes token counts for context budget management
- Chunk types: `file_summary`, `function`, `class`, `import_block`, `fallback`
- JSONB metadata: function names, complexity, dependencies

**`code_files`** - File-level metadata

- File summaries and embeddings for quick filtering
- SHA256 hash for incremental update detection
- Arrays for imports/exports tracking
- Language and line count metadata

**`code_symbols`** - Symbol registry

- Fast lookup for functions/classes/variables
- Links symbols to file locations
- Embeddings for semantic symbol search

### Key Schema Features

- **Vector dimensions:** 1024 (mxbai-embed-large)
- **Indexes:** HNSW for production (15-45 min build time on 1M vectors with high accuracy settings)
- **Performance tuning:** `hnsw.ef_search = 300` (accuracy priority)
- **Index construction:** `hnsw.ef_construction = 200` (higher quality index, longer build)

---

## 1.5 Multi-Project Architecture

cindex supports indexing and searching across **multiple independent repositories**, **monorepos**, and **microservices** with configurable search scopes and dependency-aware retrieval.

### Architecture Overview

**Three Deployment Patterns Supported:**

1. **Multi-Project (Independent Repos)** - Index multiple separate codebases, search globally or per-repo
2. **Monorepo** - Support workspace packages (`packages/*`, `apps/*`) with alias resolution
3. **Microservices** - Track service boundaries, API contracts, and cross-service dependencies

All patterns share the same database with additional metadata tables for context and relationships.

---

### Core Multi-Project Tables

Beyond the base tables (`code_chunks`, `code_files`, `code_symbols`), the schema includes:

#### 1. Repositories Table

Tracks all indexed codebases:

```sql
CREATE TABLE repositories (
    repo_id TEXT UNIQUE,              -- Unique identifier (e.g., 'auth-service')
    repo_name TEXT,                    -- Human-readable name
    repo_path TEXT,                    -- Filesystem path or URL
    repo_type TEXT,                    -- 'monolithic', 'microservice', 'monorepo', 'library', 'reference', 'documentation'
    workspace_config TEXT,             -- Workspace config file (pnpm-workspace.yaml, nx.json, etc.)
    workspace_patterns TEXT[],         -- Workspace globs (['packages/*', 'apps/*'])
    git_remote_url TEXT,
    indexed_at TIMESTAMP
);
```

**Usage:**
- Each indexed codebase gets a unique `repo_id`
- All chunks, files, and symbols tagged with `repo_id` for filtering
- Enables global search across all repos or scoped search per repo

**Repository Type Definitions:**

1. **`monolithic`** - Standard single-application codebase
   - **Use case:** Your main application code (single-purpose app)
   - **Example:** Traditional web application, mobile app, desktop app
   - **Search behavior:** Default scope for single-repo projects

2. **`microservice`** - Individual microservice repository
   - **Use case:** Service-oriented architecture, microservices
   - **Example:** auth-service, payment-service, notification-service
   - **Search behavior:** Service-scoped search with API contract linking

3. **`monorepo`** - Multi-package repository with workspace structure
   - **Use case:** Shared codebase with multiple packages/apps
   - **Example:** Turborepo, Nx, pnpm workspaces, Lerna projects
   - **Search behavior:** Workspace-aware search and import resolution

4. **`library`** - Shared library repository (your own libraries)
   - **Use case:** Internal reusable libraries and packages
   - **Example:** @mycompany/ui-components, @mycompany/utils
   - **Search behavior:** Normal priority, included in cross-repo searches

5. **`reference`** - External framework/library for learning
   - **Use case:** Index open-source frameworks to learn patterns
   - **Example:** NestJS, React, Vue, Express cloned locally
   - **Search behavior:** Excluded by default, lower priority (0.6), max 5 results
   - **Special handling:** Version tracking, lightweight indexing

6. **`documentation`** - Markdown documentation repository
   - **Use case:** API docs, guides, tutorials in markdown format
   - **Example:** /docs/libraries/, framework documentation
   - **Search behavior:** Excluded by default, lowest priority (0.5), max 3 results
   - **Special handling:** Markdown-only, fast indexing (1000 files/min)

**Architectural Patterns and Repository Type Mapping:**

cindex's 6 repository types cover all common architectural patterns:

- **Serverless Functions** → Use `monorepo` (functions as workspaces) or `library` (shared function packages)
- **Plugins/Extensions** → Use `library` (self-contained packages)
- **Event-Driven Systems** → Use `microservice` (event handlers as services) or `monorepo` (handlers as workspaces)
- **Multi-Language Codebases** → Use `monorepo` with different languages as different workspaces (see Multi-Language Monorepo Support)
- **Mobile Apps** → Use `monolithic` (single app) or `monorepo` (multi-platform: iOS + Android + Web)

**No additional repository types needed** - all architectural patterns fit into these 6 categories.

#### 2. Services Table

Tracks microservice metadata and API contracts:

```sql
CREATE TABLE services (
    service_id TEXT UNIQUE,            -- Unique service identifier
    service_name TEXT,                 -- Human-readable name
    repo_id TEXT,                      -- Repository this service belongs to
    service_path TEXT,                 -- Path to service root (for monorepo services)
    service_type TEXT,                 -- 'rest', 'graphql', 'grpc', 'library'
    api_endpoints JSONB,               -- Parsed API contracts (REST, GraphQL, gRPC)
    dependencies JSONB,                -- Service-to-service dependencies
    indexed_at TIMESTAMP
);
```

**API Contracts Storage:**
- **REST:** OpenAPI/Swagger specs parsed into JSONB (`{"endpoints": [...],"schemas": {...}}`)
- **GraphQL:** Schema types and resolvers (`{"types": [...], "queries": [...], "mutations": [...]}`)
- **gRPC:** Proto file definitions (`{"services": [...], "messages": [...]}`)

**Example JSONB (REST):**
```json
{
  "endpoints": [
    {
      "path": "/api/auth/login",
      "method": "POST",
      "summary": "Authenticate user with credentials",
      "request": {"username": "string", "password": "string"},
      "response": {"200": {"token": "string"}}
    }
  ]
}
```

#### 3. Workspaces Table

For monorepo support (Turborepo, Nx, pnpm, Lerna):

```sql
CREATE TABLE workspaces (
    workspace_id TEXT UNIQUE,          -- Generated from path (e.g., 'auth-workspace')
    package_name TEXT,                 -- Package.json name (@workspace/auth)
    workspace_path TEXT,               -- Relative path (packages/auth)
    repo_id TEXT,                      -- Parent repository
    dependencies JSONB,                -- Package.json dependencies
    tsconfig_paths JSONB,              -- TypeScript path aliases
    indexed_at TIMESTAMP
);
```

#### 4. Cross-Repository Dependencies Table

Tracks dependencies between different repositories:

```sql
CREATE TABLE cross_repo_dependencies (
    source_repo_id TEXT,               -- Repo that depends on another
    target_repo_id TEXT,               -- Repo being depended on
    dependency_type TEXT,              -- 'service', 'library', 'api', 'shared'
    source_service_id TEXT,            -- Specific service making the call
    target_service_id TEXT,            -- Specific service being called
    api_contracts JSONB,               -- API contracts if applicable
    indexed_at TIMESTAMP
);
```

**Auto-Detection:**
- Parse HTTP calls: `fetch('http://auth-service/api/verify')`
- Parse gRPC clients: `new AuthServiceClient('auth-service:50051')`
- Parse GraphQL queries: `query { getUser(id: "123") }`
- Match against indexed `services.api_endpoints`

#### 5. Workspace Dependencies Table

Internal monorepo dependencies:

```sql
CREATE TABLE workspace_dependencies (
    repo_id TEXT,
    source_workspace_id TEXT,          -- Workspace that depends on another
    target_workspace_id TEXT,          -- Workspace being depended on
    dependency_type TEXT,              -- 'runtime', 'dev', 'peer'
    version_specifier TEXT,            -- Version range from package.json
    indexed_at TIMESTAMP
);
```

#### 6. Workspace Aliases Table

Resolves monorepo import aliases:

```sql
CREATE TABLE workspace_aliases (
    repo_id TEXT,
    workspace_id TEXT,
    alias_type TEXT,                   -- 'npm_workspace', 'tsconfig_path', 'custom'
    alias_pattern TEXT,                -- '@workspace/*', '@/*', '~/*'
    resolved_path TEXT,                -- Resolved filesystem path
    UNIQUE(repo_id, alias_pattern, resolved_path)
);
```

**Examples:**
- `@workspace/shared` → `packages/shared`
- `@/components` → `src/components` (tsconfig paths)
- `~/utils` → `src/utils` (custom alias)

---

### Multi-Language Monorepo Support

**Key Architecture Principle:** Different languages in a monorepo are tracked as separate workspaces with API-based communication.

#### Workspace Language Detection

Each workspace has a primary language determined from workspace root package managers:

- `package.json` → TypeScript/JavaScript
- `requirements.txt` / `pyproject.toml` → Python
- `go.mod` → Go
- `pom.xml` / `build.gradle` → Java
- `Cargo.toml` → Rust

The `workspaces` table stores the `primary_language` for each workspace, enabling language-specific parsing and indexing strategies.

#### Cross-Language Communication Model

**Critical Rule:** Different languages in a monorepo **cannot import from each other** (different runtimes). Communication happens via API calls, not code imports.

**How It Works:**
- **NOT tracked as imports:** Python backend ←/→ TypeScript frontend (impossible to import)
- **Tracked as API calls:** HTTP requests, GraphQL queries, gRPC calls
- **Storage:** `cross_repo_dependencies` table with `dependency_type = 'api'`
- **Detection:** HTTP client usage, API endpoint calls parsed during indexing

#### Example: Python Backend + TypeScript Frontend Monorepo

```typescript
// Monorepo structure
my-fullstack-app/
├── apps/
│   ├── backend/     # Python (FastAPI)
│   │   ├── requirements.txt
│   │   ├── main.py
│   │   └── openapi.yaml
│   └── frontend/    # TypeScript (React)
│       ├── package.json
│       └── src/
│           └── api-client.ts
├── packages/
│   └── shared-types/  # TypeScript (shared between services)
│       └── package.json

// Detection Result
{
  repo_id: "my-fullstack-app",
  repo_type: "monorepo",
  workspaces: [
    {
      workspace_id: "backend",
      primary_language: "python",
      package_manager: "pip",
      root_path: "apps/backend"
    },
    {
      workspace_id: "frontend",
      primary_language: "typescript",
      package_manager: "npm",
      root_path: "apps/frontend"
    },
    {
      workspace_id: "shared-types",
      primary_language: "typescript",
      package_manager: "npm",
      root_path: "packages/shared-types"
    }
  ]
}
```

**Cross-Language API Call Detection:**

```typescript
// frontend/src/api-client.ts
fetch('/api/users')  // ← Detected as API call to backend

// Stored in cross_repo_dependencies
{
  source_repo_id: "my-fullstack-app",
  source_workspace_id: "frontend",
  target_workspace_id: "backend",
  dependency_type: "api",
  api_contracts: {
    endpoint: "/api/users",
    method: "GET"
  }
}
```

#### Indexing Strategy for Multi-Language Monorepos

1. **Workspace Detection:** Scan for package managers, detect primary language per workspace
2. **Language-Specific Parsing:** Use Python parser for backend, TypeScript parser for frontend
3. **Import Resolution:**
   - **Same-language imports:** Resolve normally (TypeScript → TypeScript)
   - **Cross-language references:** Skip import resolution, detect API calls instead
4. **API Call Detection:** Parse HTTP clients, GraphQL queries, gRPC proto files
5. **Dependency Storage:** Cross-language deps stored as `dependency_type = 'api'`

#### Search Behavior

**Workspace-Scoped Search (Respects Language Boundaries):**

```typescript
await search_codebase({
  query: "user authentication",
  scope: "workspace",
  workspace_id: "backend"  // Only Python backend code
});

// Returns: Python authentication functions only
// Does NOT return TypeScript frontend code
```

**Cross-Workspace Search (API-Linked Results):**

```typescript
await search_codebase({
  query: "user API implementation",
  scope: "repository",
  repo_id: "my-fullstack-app"
});

// Returns:
// 1. Backend (Python): User model, auth endpoints
// 2. Frontend (TypeScript): API client calling user endpoints
// 3. Linked via API contracts (not imports)
```

#### Import Chain Expansion Rules

**Rule:** Import chain expansion **stops at language boundaries**.

```typescript
// frontend/src/UserList.tsx (TypeScript)
import { UserService } from './services/user.service';  // ✅ Expand (same language)

// services/user.service.ts (TypeScript)
import { apiClient } from './api-client';  // ✅ Expand (same language)

// api-client.ts (TypeScript)
fetch('/api/users')  // ❌ STOP - Different language (Python backend)
                     // Treat as API call, not import
```

**Why This Matters:**
- Prevents infinite loops across language boundaries
- Correctly models actual code architecture (API-based communication)
- Ensures search results reflect real dependencies (not fake import chains)

---

### Configurable Search Scopes

cindex supports four search modes via the `scope` parameter in `search_codebase`:

#### Mode 1: Global Search (Default)

Search across **all indexed repositories**:

```typescript
await search_codebase({
  query: "How is authentication handled?",
  scope: "global",  // Search all repos
  max_files: 15
});
```

**SQL Query:**
```sql
SELECT f.*, r.repo_name
FROM code_files f
JOIN repositories r ON f.repo_id = r.repo_id
WHERE 1 - (f.summary_embedding <=> query_embedding) > 0.70
ORDER BY f.summary_embedding <=> query_embedding
LIMIT 30;
```

**Output:**
```json
{
  "results": [
    {"repo": "auth-service", "file": "src/auth/login.ts", "relevance": 0.92},
    {"repo": "api-gateway", "file": "src/middleware/auth.ts", "relevance": 0.87},
    {"repo": "user-service", "file": "src/models/user.ts", "relevance": 0.81}
  ]
}
```

#### Mode 2: Repository-Scoped Search

Search within a **specific repository**:

```typescript
await search_codebase({
  query: "JWT token validation",
  scope: "repository",
  repo_id: "auth-service",  // Only search auth-service
  max_snippets: 20
});
```

**SQL Query:**
```sql
SELECT * FROM code_chunks
WHERE repo_id = 'auth-service'
  AND 1 - (embedding <=> query_embedding) > 0.75
ORDER BY embedding <=> query_embedding
LIMIT 100;
```

#### Mode 3: Service-Scoped Search

Search within a **specific microservice**:

```typescript
await search_codebase({
  query: "GraphQL resolvers for user queries",
  scope: "service",
  service_id: "user-api",  // Only search user-api service
});
```

**SQL Query:**
```sql
SELECT * FROM code_chunks
WHERE service_id = 'user-api'
  AND 1 - (embedding <=> query_embedding) > 0.75;
```

#### Mode 4: Boundary-Aware Search (Dependency Traversal)

Start in one repository and **automatically expand to its dependencies**:

```typescript
await search_codebase({
  query: "Payment processing flow",
  scope: "boundary-aware",
  start_repo: "payment-service",
  include_dependencies: true,
  dependency_depth: 2  // Max depth to traverse
});
```

**Retrieval Flow:**

1. **Search in primary repo** (`payment-service`)
2. **Query cross-repo dependencies** to find what payment-service depends on
3. **Expand search** to dependent repos (e.g., `auth-service`, `notification-service`)
4. **Include API contracts** from `services.api_endpoints`
5. **Limit depth** to prevent runaway expansion

**SQL Query (Recursive CTE):**
```sql
WITH RECURSIVE repo_deps AS (
  -- Base case: starting repo
  SELECT 'payment-service' as repo_id, 0 as depth

  UNION

  -- Recursive case: repos that payment-service depends on
  SELECT crd.target_repo_id, rd.depth + 1
  FROM repo_deps rd
  JOIN cross_repo_dependencies crd ON rd.repo_id = crd.source_repo_id
  WHERE rd.depth < 2  -- Max depth
)
SELECT c.*, r.repo_name, rd.depth as dependency_depth
FROM code_chunks c
JOIN repositories r ON c.repo_id = r.repo_id
JOIN repo_deps rd ON c.repo_id = rd.repo_id
WHERE 1 - (c.embedding <=> query_embedding) > 0.75
ORDER BY rd.depth ASC, c.embedding <=> query_embedding
LIMIT 100;
```

**Output:**
```json
{
  "results": {
    "primary": {
      "repo": "payment-service",
      "chunks": [...]
    },
    "dependencies": [
      {
        "repo": "auth-service",
        "depth": 1,
        "relation": "Verifies user authentication before payment",
        "api_contracts": ["/api/verify"],
        "chunks": [...]
      },
      {
        "repo": "notification-service",
        "depth": 1,
        "relation": "Sends payment confirmation emails",
        "chunks": [...]
      }
    ]
  }
}
```

---

### API Contract Indexing

cindex indexes API definitions from OpenAPI/Swagger, GraphQL schemas, and gRPC proto files.

#### REST API (OpenAPI/Swagger)

**Source:** `openapi.yaml` or `swagger.json`

```yaml
paths:
  /api/auth/login:
    post:
      summary: Authenticate user with credentials
      requestBody:
        content:
          application/json:
            schema:
              properties:
                username: { type: string }
                password: { type: string }
      responses:
        '200':
          description: Authentication successful
          content:
            application/json:
              schema:
                properties:
                  token: { type: string }
```

**Stored in `services.api_endpoints` (JSONB):**
```json
{
  "openapi": "3.0.0",
  "endpoints": [
    {
      "path": "/api/auth/login",
      "method": "POST",
      "summary": "Authenticate user with credentials",
      "request_schema": {"username": "string", "password": "string"},
      "response_schema": {"200": {"token": "string"}},
      "implementation_file": "src/controllers/auth.ts",
      "implementation_lines": "45-67"
    }
  ]
}
```

#### GraphQL API

**Source:** `schema.graphql`

```graphql
type Query {
  getUser(id: ID!): User
  getPayments(userId: ID!): [Payment]
}

type Mutation {
  processPayment(input: PaymentInput!): PaymentResult
}

type User {
  id: ID!
  username: String!
  email: String!
}
```

**Stored in `services.api_endpoints` (JSONB):**
```json
{
  "schema_type": "graphql",
  "types": [
    {"name": "User", "fields": ["id", "username", "email"]},
    {"name": "Query", "fields": [
      {"name": "getUser", "args": ["id: ID!"], "returns": "User"},
      {"name": "getPayments", "args": ["userId: ID!"], "returns": "[Payment]"}
    ]},
    {"name": "Mutation", "fields": [
      {"name": "processPayment", "args": ["input: PaymentInput!"], "returns": "PaymentResult"}
    ]}
  ],
  "resolvers": {
    "Query.getUser": {"file": "src/resolvers/user.ts", "lines": "12-25"},
    "Mutation.processPayment": {"file": "src/resolvers/payment.ts", "lines": "34-78"}
  }
}
```

#### gRPC API

**Source:** `*.proto` files

```protobuf
syntax = "proto3";

service AuthService {
  rpc Login(LoginRequest) returns (LoginResponse);
  rpc VerifyToken(TokenRequest) returns (TokenResponse);
}

message LoginRequest {
  string username = 1;
  string password = 2;
}

message LoginResponse {
  string token = 1;
  int64 expires_at = 2;
}
```

**Stored in `services.api_endpoints` (JSONB):**
```json
{
  "schema_type": "grpc",
  "services": [
    {
      "name": "AuthService",
      "methods": [
        {
          "name": "Login",
          "request": "LoginRequest",
          "response": "LoginResponse",
          "implementation_file": "src/grpc/auth-service.ts",
          "implementation_lines": "89-112"
        },
        {
          "name": "VerifyToken",
          "request": "TokenRequest",
          "response": "TokenResponse"
        }
      ]
    }
  ],
  "messages": [
    {"name": "LoginRequest", "fields": ["username", "password"]},
    {"name": "LoginResponse", "fields": ["token", "expires_at"]}
  ]
}
```

---

### Enhanced Retrieval Pipeline (7 Stages)

The multi-project architecture extends the retrieval pipeline from 4 stages to 7:

**Stage 0: Scope Filtering (NEW)**
- Determine search scope (global, repository, service, boundary-aware)
- If boundary-aware: Resolve dependency graph from `cross_repo_dependencies`
- Generate `repo_id` filter list for subsequent stages

**Stage 1: File-Level Retrieval**
- Apply `repo_id` filter from Stage 0
- Query `code_files` with `summary_embedding`
- Return top N files per repository

**Stage 2: Chunk-Level Retrieval**
- Query `code_chunks` within filtered files
- Apply `repo_id`/`service_id` filters
- Return top M chunks

**Stage 3: Symbol Resolution**
- Query `code_symbols` for imported symbols
- Respect repository boundaries (only resolve if in indexed repos)
- Return symbol definitions

**Stage 4: Import Chain Expansion**
- Follow import chains within and across repositories
- Check `cross_repo_dependencies` for cross-service imports
- Limit depth per repository (default: 3)

**Stage 5: API Contract Enrichment (NEW)**
- Query `services.api_endpoints` for relevant APIs
- Match code chunks to API implementations
- Include REST/GraphQL/gRPC definitions
- Add API call relationships

**Stage 6: Deduplication**
- Deduplicate across all repositories
- Keep highest-scoring version
- Note: Same utility in different repos may be intentional (tag, don't remove)

**Stage 7: Context Assembly**
- Group results by repository
- Show dependency relationships (depth levels)
- Include API contracts
- Add repository/service metadata

---

### Cross-Service Dependency Detection

cindex automatically detects cross-service dependencies by parsing code for service calls.

#### Detection Patterns

**1. HTTP/REST Calls:**
```typescript
// payment-service/src/process-payment.ts
const verifyUser = async (token: string) => {
  const response = await fetch('http://auth-service/api/verify', {
    method: 'POST',
    body: JSON.stringify({ token })
  });
  return response.json();
};
```

**Detected:**
- Source: `payment-service`
- Target: `auth-service`
- API endpoint: `/api/verify`
- Method: `POST`

**2. gRPC Calls:**
```typescript
// payment-service/src/auth-client.ts
import { AuthServiceClient } from './proto/auth_grpc_pb';

const client = new AuthServiceClient('auth-service:50051');
const response = await client.Login(loginRequest);
```

**Detected:**
- Source: `payment-service`
- Target: `auth-service`
- RPC method: `Login`
- Protocol: `grpc`

**3. GraphQL Queries:**
```typescript
// dashboard-service/src/data-fetcher.ts
const { data } = await graphqlClient.query({
  query: gql`
    query GetUser($id: ID!) {
      getUser(id: $id) {
        username
        email
      }
    }
  `
});
```

**Detected:**
- Source: `dashboard-service`
- Target: Service hosting GraphQL API
- Query: `GetUser`
- Protocol: `graphql`

#### Storage in Cross-Repo Dependencies

```sql
INSERT INTO cross_repo_dependencies (
  source_repo_id, target_repo_id, dependency_type,
  source_service_id, target_service_id, api_contracts
) VALUES (
  'payment-service', 'auth-service', 'api',
  'payment-api', 'auth-api',
  '{"endpoint": "/api/verify", "method": "POST", "usage_count": 3}'::jsonb
);
```

#### Retrieval Enhancement

When searching with `include_dependencies=true`:

1. Detect service calls in retrieved code chunks
2. Query `cross_repo_dependencies` for related services
3. Fetch API contract definitions from `services.api_endpoints`
4. Include implementation code from target service
5. Show relationship: "payment-service calls auth-service.verify()"

**Example Output:**
```json
{
  "chunk": {
    "file": "payment-service/src/process-payment.ts",
    "code": "const response = await fetch('http://auth-service/api/verify', ...)",
    "service_calls": [
      {
        "target_service": "auth-service",
        "api_endpoint": "/api/verify",
        "contract": {
          "method": "POST",
          "request": {"token": "string"},
          "response": {"valid": "boolean", "user_id": "string"}
        },
        "implementation": {
          "file": "auth-service/src/controllers/verify.ts",
          "lines": "23-45",
          "code": "export const verifyToken = async (req, res) => { ... }"
        }
      }
    ]
  }
}
```

---

### Multi-Project Indexing Workflow

#### Indexing Multiple Repositories

```typescript
// Index first repository (auth-service)
await index_repository({
  repo_path: "/workspace/auth-service",
  repo_id: "auth-service",
  repo_type: "microservice",
  service_config: {
    service_id: "auth-api",
    service_type: "rest",
    api_spec_path: "./docs/openapi.yaml"
  }
});

// Index second repository (payment-service)
await index_repository({
  repo_path: "/workspace/payment-service",
  repo_id: "payment-service",
  repo_type: "microservice",
  service_config: {
    service_id: "payment-api",
    service_type: "rest",
    api_spec_path: "./api/swagger.json"
  },
  detect_dependencies: true,
  dependency_repos: ["auth-service"]  // Link against already indexed repos
});
```

**Indexing Steps:**

1. **Parse repository metadata** → Insert into `repositories` table
2. **Parse service config** → Insert into `services` table
3. **Parse API contracts** (OpenAPI/GraphQL/gRPC) → Store in `services.api_endpoints`
4. **Index code files** → Populate `code_chunks`, `code_files`, `code_symbols` with `repo_id`
5. **Detect service calls** → Populate `cross_repo_dependencies`
6. **Build embeddings** → Generate vectors for all chunks and API definitions

#### Incremental Re-indexing with Multi-Project

```typescript
// Re-index only changed files in auth-service
await index_repository({
  repo_id: "auth-service",
  incremental: true  // Only update changed files
});
```

**Process:**
1. Compare file hashes for `repo_id = 'auth-service'`
2. Re-embed only modified files
3. Update `cross_repo_dependencies` if imports changed
4. Update `services.api_endpoints` if API contracts changed

---

### MCP Tools with Multi-Project Support

#### Updated: `search_codebase`

```typescript
{
  name: "search_codebase",
  description: "Semantic search with configurable scope (global, repo, service, boundary-aware)",
  inputSchema: {
    query: string,

    // NEW: Scope configuration
    scope: "global" | "repository" | "service" | "boundary-aware",
    repo_id?: string,           // For scope=repository
    service_id?: string,        // For scope=service
    start_repo?: string,        // For scope=boundary-aware

    // NEW: Dependency expansion
    include_dependencies: boolean,  // Default: false
    dependency_depth: number,       // Default: 2

    // NEW: API contract search
    search_api_contracts: boolean,  // Default: true

    // Existing parameters
    max_files: number,              // Default: 15
    max_snippets: number,           // Default: 25
    include_imports: boolean,
    import_depth: number
  }
}
```

#### NEW: `search_api_contracts`

Search API contracts across services:

```typescript
{
  name: "search_api_contracts",
  description: "Search API contracts (REST/GraphQL/gRPC) across services",
  inputSchema: {
    query: string,              // "login endpoint" or "payment mutation"
    api_type?: "rest" | "graphql" | "grpc" | "all",  // Default: "all"
    service_id?: string,        // Optional: scope to specific service
    include_implementation: boolean  // Include code implementing these APIs
  },
  returns: {
    contracts: [
      {
        service: "auth-api",
        type: "rest",
        endpoint: "/api/auth/login",
        method: "POST",
        summary: "Authenticate user credentials",
        implementation_file: "src/controllers/auth.ts",
        implementation_lines: "45-67",
        implementation_code: "export const login = async (...) => { ... }"
      }
    ]
  }
}
```

#### NEW: `list_indexed_repos`

List all indexed repositories and services:

```typescript
{
  name: "list_indexed_repos",
  description: "List all indexed repositories and services",
  inputSchema: {},
  returns: {
    repositories: [
      {
        repo_id: "auth-service",
        repo_name: "Authentication Service",
        repo_type: "microservice",
        indexed_at: "2025-01-18T10:30:00Z",
        total_files: 245,
        total_chunks: 1823,
        services: [
          {
            service_id: "auth-api",
            service_type: "rest",
            api_endpoints_count: 12,
            dependencies_count: 2
          }
        ]
      },
      {
        repo_id: "payment-service",
        repo_name: "Payment Service",
        repo_type: "microservice",
        indexed_at: "2025-01-18T11:15:00Z",
        total_files: 189,
        services: [...]
      }
    ]
  }
}
```

#### Updated: `index_repository`

```typescript
{
  name: "index_repository",
  description: "Index or re-index a codebase with multi-project support",
  inputSchema: {
    repo_path: string,

    // NEW: Multi-project support
    repo_id: string,            // Unique identifier (required for multi-project)
    repo_type: "monorepo" | "microservice" | "monolithic" | "library",

    // NEW: Service configuration
    service_config?: {
      service_id: string,
      service_type: "rest" | "graphql" | "grpc" | "library",
      api_spec_path?: string,   // Path to openapi.yaml, schema.graphql, *.proto
    },

    // NEW: Cross-repo dependency detection
    detect_dependencies: boolean,      // Analyze imports for cross-service calls
    dependency_repos?: string[],       // List of other indexed repos to link against

    // Existing parameters
    incremental: boolean,              // Default: true
    languages: string[],
    include_markdown: boolean,
    respect_gitignore: boolean,
    max_file_size: number,
    summary_method: "llm" | "rule-based"
  }
}
```

---

### Example: Multi-Service Query Flow

**Query:** "How does payment processing work?"

**Tool Call:**
```typescript
await search_codebase({
  query: "How does payment processing work?",
  scope: "boundary-aware",
  start_repo: "payment-service",
  include_dependencies: true,
  dependency_depth: 2,
  search_api_contracts: true
});
```

**Retrieval Process:**

1. **Stage 0: Scope Filtering**
   - Start repo: `payment-service`
   - Query `cross_repo_dependencies` → Find deps: `auth-service`, `notification-service`
   - Repo filter: `['payment-service', 'auth-service', 'notification-service']`

2. **Stage 1: File-Level Retrieval**
   ```sql
   SELECT * FROM code_files
   WHERE repo_id IN ('payment-service', 'auth-service', 'notification-service')
     AND 1 - (summary_embedding <=> query_embedding) > 0.70
   ORDER BY
     CASE WHEN repo_id = 'payment-service' THEN 0 ELSE 1 END,
     summary_embedding <=> query_embedding
   LIMIT 30;
   ```

3. **Stage 2: Chunk Retrieval**
   - Get chunks from top files
   - Tag with `dependency_depth`: 0 (primary), 1 (direct dep), 2 (indirect dep)

4. **Stage 3: Symbol Resolution**
   - Resolve imported symbols across repos

5. **Stage 4: Import Chain Expansion**
   - Follow imports within depth limit

6. **Stage 5: API Contract Enrichment**
   ```sql
   SELECT crd.target_service_id, crd.api_contracts, s.api_endpoints
   FROM cross_repo_dependencies crd
   JOIN services s ON crd.target_service_id = s.service_id
   WHERE crd.source_repo_id = 'payment-service';
   ```

7. **Stage 6: Deduplication**
   - Remove duplicate utilities (cross-repo aware)

8. **Stage 7: Context Assembly**

**Final Output:**
```json
{
  "query": "How does payment processing work?",
  "scope": "boundary-aware",
  "metadata": {
    "total_repos_searched": 3,
    "total_files": 12,
    "total_chunks": 28,
    "dependency_depth_reached": 1,
    "query_time_ms": 720
  },
  "results": {
    "primary_service": {
      "repo": "payment-service",
      "service": "payment-api",
      "files": ["src/process-payment.ts", "src/payment-validator.ts"],
      "chunks": [
        {
          "file": "src/process-payment.ts",
          "lines": "45-80",
          "relevance": 0.94,
          "code": "export const processPayment = async (userId, amount) => {\n  // Verify user authentication\n  const user = await authClient.verify(userId);\n  ...\n}",
          "service_calls": [
            {
              "target": "auth-service",
              "api": "/api/verify",
              "contract": {/* API contract details */}
            }
          ]
        }
      ]
    },
    "dependencies": [
      {
        "repo": "auth-service",
        "service": "auth-api",
        "depth": 1,
        "relationship": "Verifies user authentication before payment",
        "api_contracts": [
          {
            "endpoint": "/api/verify",
            "method": "POST",
            "summary": "Verify JWT token validity",
            "request": {"token": "string"},
            "response": {"valid": "boolean", "user_id": "string"}
          }
        ],
        "implementation": {
          "file": "src/controllers/verify.ts",
          "lines": "23-45",
          "code": "export const verifyToken = async (req, res) => { ... }",
          "relevance": 0.87
        }
      },
      {
        "repo": "notification-service",
        "service": "notification-api",
        "depth": 1,
        "relationship": "Sends payment confirmation emails",
        "api_contracts": [
          {
            "endpoint": "/api/notifications/send",
            "method": "POST"
          }
        ]
      }
    ]
  }
}
```

---

## Installation

### Via NPM (Recommended)

```bash
npm install -g @gianged/cindex
```

Or use with npx (no installation required):

```bash
npx @gianged/cindex
```

### From Source

```bash
git clone https://github.com/gianged/cindex.git
cd cindex
npm install
npm run build
```

### Quick Start

1. **Install prerequisites:**

   ```bash
   # PostgreSQL with pgvector
   sudo apt install postgresql-16 postgresql-16-pgvector

   # Ollama
   curl https://ollama.ai/install.sh | sh
   ollama pull mxbai-embed-large
   ollama pull qwen2.5-coder:1.5b
   ```

2. **Set up database:**

   ```bash
   createdb cindex_rag_codebase
   psql cindex_rag_codebase < database.sql
   ```

3. **Configure MCP:** Add to `~/.claude.json` (user scope) or `.mcp.json` (project scope)

4. **Start indexing:** Use the `index_repository` tool from Claude Code

---

## 2. MCP Configuration

### Environment Variables

The MCP server is configured via environment variables in the MCP `.json` configuration file. All
settings have sensible defaults but can be overridden.

**MCP Configuration File Locations:**

- **User scope (all projects):** `~/.claude.json` in home directory
- **Project scope (team-shared):** `.mcp.json` in project root

**Configuration Example:**

```json
{
  "mcpServers": {
    "cindex": {
      "command": "npx",
      "args": ["-y", "@gianged/cindex"],
      "env": {
        "EMBEDDING_MODEL": "mxbai-embed-large",
        "EMBEDDING_DIMENSIONS": "1024",
        "SUMMARY_MODEL": "qwen2.5-coder:3b",
        "OLLAMA_HOST": "http://localhost:11434",
        "POSTGRES_HOST": "localhost",
        "POSTGRES_PORT": "5432",
        "POSTGRES_DB": "cindex_rag_codebase",
        "POSTGRES_USER": "postgres",
        "POSTGRES_PASSWORD": "your_password",
        "HNSW_EF_SEARCH": "300",
        "HNSW_EF_CONSTRUCTION": "200",
        "SIMILARITY_THRESHOLD": "0.75",
        "DEDUP_THRESHOLD": "0.92"
      }
    }
  }
}
```

### Environment Variable Reference

#### Model Configuration

- **`EMBEDDING_MODEL`** (default: `mxbai-embed-large`)
  - Ollama embedding model to use
  - Alternatives: `nomic-embed-text`, `mxbai-embed-large`, custom models
  - Must match `EMBEDDING_DIMENSIONS`

- **`EMBEDDING_DIMENSIONS`** (default: `1024`)
  - Vector dimensions for embeddings
  - Must match the model's output dimensions
  - `mxbai-embed-large`: 1024
  - `nomic-embed-text`: 768

- **`SUMMARY_MODEL`** (default: `qwen2.5-coder:1.5b`)
  - Ollama model for generating file summaries
  - Options: `qwen2.5-coder:1.5b` (fast), `qwen2.5-coder:3b` (accurate), `qwen2.5-coder:7b` (best)
  - Set to empty string to disable LLM summaries (use rule-based)

- **`OLLAMA_HOST`** (default: `http://localhost:11434`)
  - Ollama API endpoint
  - Change if running Ollama on different host/port

#### PostgreSQL Configuration

- **`POSTGRES_HOST`** (default: `localhost`)
  - PostgreSQL server hostname or IP

- **`POSTGRES_PORT`** (default: `5432`)
  - PostgreSQL server port
  - Common alternative: `5433` for secondary instances

- **`POSTGRES_DB`** (default: `cindex_rag_codebase`)
  - Database name

- **`POSTGRES_USER`** (default: `postgres`)
  - Database username

- **`POSTGRES_PASSWORD`** (required)
  - Database password
  - No default for security

#### Accuracy/Performance Tuning

- **`HNSW_EF_SEARCH`** (default: `300`)
  - HNSW search quality parameter (40-400)
  - Higher = more accurate, slower queries
  - Accuracy priority: 300
  - Speed priority: 100

- **`HNSW_EF_CONSTRUCTION`** (default: `200`)
  - HNSW index build quality (64-400)
  - Higher = better index quality, longer build time
  - Accuracy priority: 200
  - Speed priority: 64

- **`SIMILARITY_THRESHOLD`** (default: `0.75`)
  - Minimum similarity score for chunk retrieval (0.0-1.0)
  - Higher = fewer but more relevant results
  - Accuracy priority: 0.75
  - Speed priority: 0.70

- **`DEDUP_THRESHOLD`** (default: `0.92`)
  - Similarity threshold for deduplication (0.0-1.0)
  - Lower = more aggressive deduplication
  - Accuracy priority: 0.92
  - Speed priority: 0.95

### Configuration Presets

**Accuracy-First (Default):**

```json
"env": {
  "EMBEDDING_MODEL": "mxbai-embed-large",
  "EMBEDDING_DIMENSIONS": "1024",
  "SUMMARY_MODEL": "qwen2.5-coder:3b",
  "HNSW_EF_SEARCH": "300",
  "HNSW_EF_CONSTRUCTION": "200",
  "SIMILARITY_THRESHOLD": "0.75",
  "DEDUP_THRESHOLD": "0.92"
}
```

**Speed-First (Alternative):**

```json
"env": {
  "EMBEDDING_MODEL": "mxbai-embed-large",
  "EMBEDDING_DIMENSIONS": "1024",
  "SUMMARY_MODEL": "qwen2.5-coder:1.5b",
  "HNSW_EF_SEARCH": "100",
  "HNSW_EF_CONSTRUCTION": "64",
  "SIMILARITY_THRESHOLD": "0.70",
  "DEDUP_THRESHOLD": "0.95"
}
```

**Custom PostgreSQL Port Example:**

```json
"env": {
  "POSTGRES_HOST": "192.168.1.100",
  "POSTGRES_PORT": "5433",
  "POSTGRES_DB": "my_cindex_db",
  "POSTGRES_USER": "rag_user",
  "POSTGRES_PASSWORD": "secure_password"
}
```

**Remote Ollama Setup:**

```json
"env": {
  "OLLAMA_HOST": "http://192.168.1.50:11434",
  "EMBEDDING_MODEL": "mxbai-embed-large",
  "SUMMARY_MODEL": "qwen2.5-coder:7b"
}
```

### Configuration Notes

1. **Model Dimensions Must Match:**
   - If changing `EMBEDDING_MODEL`, update `EMBEDDING_DIMENSIONS`
   - Mismatch will cause vector dimension errors in PostgreSQL

2. **Re-indexing After Model Changes:**
   - Changing `EMBEDDING_MODEL` requires full re-index
   - Changing `SUMMARY_MODEL` only affects new/updated files

3. **HNSW Parameters:**
   - Changes to `HNSW_EF_SEARCH` take effect immediately (runtime parameter)
   - Changes to `HNSW_EF_CONSTRUCTION` require index rebuild

4. **PostgreSQL Connection:**
   - Use connection pooling for production
   - Ensure `POSTGRES_PASSWORD` is kept secure
   - Consider using PostgreSQL environment variables or `.pgpass` file

---

## 3. Indexing Pipeline

### Stage 1: File Discovery & Parsing

```
Input: Codebase path

File Filtering Rules:
- Respect .gitignore patterns (use gitignore parser)
- Always ignore: node_modules, .git, dist, build, coverage, .next, out
- Skip binary files: .png, .jpg, .pdf, .exe, .zip, .so, .dylib
- Skip generated files: package-lock.json, yarn.lock, .min.js, .bundle.js
- Skip documentation: .md, .txt (configurable - see note below)
- Skip large files: >5000 lines (index structure only)
- Include: .ts, .js, .tsx, .jsx, .py, .java, .go, .rs, .c, .cpp, .h, etc.

Process:
1. Walk directory tree with filters applied
2. Compute SHA256 hash for each file (for incremental updates)
3. Detect language per file (by extension + shebang)
4. Parse with tree-sitter for syntax-aware chunking (fallback if unavailable)
5. Extract metadata: imports, exports, symbols

Note on .md files:
- Skip by default (docs don't help code understanding)
- Exception: README.md at repo root (contains high-level architecture)
- Exception: API docs if they contain code examples
- Make configurable via indexing options
```

### Stage 2: Chunking Strategy

```
For each file:
├── File Summary (1 chunk)
│   └── Generate: "This file implements X, exports Y, handles Z"
│   └── Methods (Accuracy Priority):
│       ├── LLM-based: qwen2.5-coder:1.5b or 3b on first 100 lines (preferred, high quality)
│       └── Rule-based fallback: Extract top comment + exports (only if LLM unavailable)
│
├── Import Block (1 chunk if exists)
│   └── All import/require statements grouped
│
├── Semantic Chunks (N chunks)
│   ├── Tree-sitter parsing (preferred):
│   │   ├── Functions: Full function definition + docstring
│   │   ├── Classes: Class definition + public methods
│   │   ├── Top-level code: Logical blocks (not arbitrary splits)
│   │   └── Each chunk: 50-500 lines (aim for complete logical units)
│   │
│   └── Fallback (if tree-sitter fails/unsupported):
│       ├── Sliding window: 200 lines per chunk with 20-line overlap
│       ├── Regex detect function boundaries (language-specific)
│       ├── Break at natural boundaries (blank lines, comments)
│       └── Mark as chunk_type: 'fallback' for quality tracking
│
├── Large File Handling (>1000 lines)
│   ├── Detect major sections (classes, modules, comment headers)
│   ├── Treat each section as logical sub-file
│   ├── Chunk within sections normally
│   └── Files >5000 lines: Index only top-level structure + exports
│
└── Metadata Extraction
    ├── Cyclomatic complexity (functions)
    ├── Dependencies (what this code calls)
    ├── Token count (for context budget: ~4 chars = 1 token estimate)
    └── Line ranges
```

### Stage 3: Embedding Generation

```
For each chunk:
1. Construct enhanced text for embedding:
   - Prepend: file path, language, chunk type
   - Include: actual code + surrounding context (2 lines before/after)
   - Append: extracted symbols/function names

Example input to embedding model:
"FILE: src/auth/login.ts | TYPE: function | LANG: typescript
function authenticateUser(username: string, password: string): Promise<User> {
  // Validates credentials against database
  // Returns User object or throws AuthError
  ...
}
SYMBOLS: authenticateUser, User, AuthError"

2. Generate embedding via Ollama (mxbai-embed-large)
3. Store in appropriate table
```

---

### Incremental Indexing Status

**Current Implementation:** Base indexing pipeline is complete (file discovery → parsing → chunking → embedding → storage)

**What Works Today:**
- SHA256 hash computation during file discovery (`file-walker.ts`)
- `file_hash` column stored in `code_files` table
- `force_reindex` parameter support (`version-tracker.ts`)
- Version tracking and comparison for reference repositories
- Full re-index capability via `clearRepositoryData()`

**What's Planned (Phase 6):**
- Hash comparison logic to classify files:
  - **New files:** Not in database → Full indexing
  - **Modified files:** Hash changed → Delete old chunks, re-index
  - **Unchanged files:** Hash match → Skip completely
  - **Deleted files:** In DB but not on disk → Remove with CASCADE
- Process only new + modified files (skip unchanged)
- Expected performance after implementation:
  - 100 changed files: <15 seconds
  - Entire codebase unchanged: <5 seconds (hash comparison only)

**Current Behavior:**
- All files are re-indexed on each `index_repository` call
- Use `force_reindex: true` to explicitly clear all data before re-indexing
- Use `incremental: true` (default) to enable hash comparison when implemented
- Repository version tracking works for reference repositories (skip re-index if version unchanged)

**Usage Example:**

```typescript
// Current: Full re-index (until Phase 6 implements hash comparison)
await index_repository({
  repo_path: "/workspace/my-app",
  repo_id: "my-app",
  incremental: true  // Planned feature, not yet functional
});

// Force full re-index (clear all data first)
await index_repository({
  repo_path: "/workspace/my-app",
  repo_id: "my-app",
  force_reindex: true  // ✅ Works today
});

// Version-based re-indexing for reference repos (works today)
await index_repository({
  repo_path: "/references/nestjs",
  repo_id: "nestjs-ref",
  repo_type: "reference",
  version: "v10.3.0"  // ✅ Works - skips if version unchanged
});
```

**Implementation Gap:**
- Missing `compareFileHashes()` function to query existing hashes and classify files
- Missing selective chunk deletion (currently deletes entire repository data)
- MCP `index_repository` tool not yet created (Phase 5)

See `docs/tasks/phase-6.md` for incremental indexing implementation plan.

---

### Example: Learning from Reference Repositories

**Scenario:** Learning NestJS patterns while building your application

#### Setup: Index Your App + Reference Framework

```typescript
// 1. Index your application
await index_repository({
  repo_path: '/workspace/my-nestjs-app',
  repo_id: 'my-app',
  repo_type: 'monolithic'
});

// 2. Index NestJS framework as reference
await index_repository({
  repo_path: '/references/nestjs',
  repo_id: 'nestjs-ref',
  repo_type: 'reference',
  version: 'v10.3.0',
  metadata: {
    upstream_url: 'https://github.com/nestjs/nest',
    indexed_for: 'learning'
  }
});
```

#### Query 1: Default Search (Your Code Only)

```typescript
await search_codebase({
  query: 'how to implement guards',
  scope: 'repository',
  repo_id: 'my-app'
});

// Returns: Only your application code
// Results:
// - my-app/src/guards/auth.guard.ts (0.95)
// - my-app/src/guards/roles.guard.ts (0.88)
// - my-app/src/middleware/auth.middleware.ts (0.82)
//
// No reference repository results (excluded by default)
```

#### Query 2: Include Reference Examples for Learning

```typescript
await search_codebase({
  query: 'how to implement guards',
  scope: 'global',
  include_references: true,
  max_reference_results: 5
});

// Returns: Mixed results prioritized by repository type
//
// Primary Code (priority 1.0):
// 1. my-app/src/guards/auth.guard.ts (0.95 * 1.0 = 0.95)
// 2. my-app/src/guards/roles.guard.ts (0.88 * 1.0 = 0.88)
// 3. my-app/src/middleware/auth.middleware.ts (0.82 * 1.0 = 0.82)
//
// Reference Examples (priority 0.6):
// 4. nestjs-ref/packages/common/guards/auth-guard.ts (0.92 * 0.6 = 0.55)
// 5. nestjs-ref/sample/guards-sample/guards/auth.guard.ts (0.87 * 0.6 = 0.52)
// 6. nestjs-ref/packages/core/guards/guards-consumer.ts (0.85 * 0.6 = 0.51)
//
// Max 5 reference results, sorted by adjusted priority
// Your code always appears first
```

#### Query 3: List All Indexed Repositories

```typescript
await list_indexed_repos();

// Returns repository metadata grouped by type
{
  repositories: [
    {
      repo_id: 'my-app',
      repo_type: 'monolithic',
      file_count: 450,
      chunk_count: 2340,
      last_indexed: '2025-01-18T10:30:00Z',
      indexed_at: '2025-01-18T10:30:00Z'
    },
    {
      repo_id: 'nestjs-ref',
      repo_type: 'reference',
      version: 'v10.3.0',
      upstream_url: 'https://github.com/nestjs/nest',
      file_count: 850,
      chunk_count: 4200,
      last_indexed: '2025-01-15T08:20:00Z',
      exclude_from_default_search: true,
      indexed_for: 'learning'
    }
  ]
}
```

#### Query 4: Version Update Workflow

```typescript
// Pull latest NestJS version
// $ cd /references/nestjs
// $ git pull
// Updated to v11.0.0

// Re-index with new version
await index_repository({
  repo_path: '/references/nestjs',
  repo_id: 'nestjs-ref',
  repo_type: 'reference',
  version: 'v11.0.0',  // Version changed
  force_reindex: true   // Clear old data first
});

// System behavior:
// 1. Detects version change (v10.3.0 → v11.0.0)
// 2. Calls clearRepositoryData() to remove old index
// 3. Re-indexes entire repository with new version
// 4. Updates metadata with new version and timestamp
```

#### Query 5: Documentation Repository Example

```typescript
// Index library documentation
await index_repository({
  repo_path: '/workspace/my-app/docs/libraries',
  repo_id: 'lib-docs',
  repo_type: 'documentation'
});

// Search including documentation
await search_codebase({
  query: 'API usage examples',
  scope: 'global',
  include_documentation: true,
  max_documentation_results: 3
});

// Returns:
// Primary Code (priority 1.0):
// - my-app/src/api/client.ts (0.88)
// - my-app/src/services/user.service.ts (0.85)
//
// Documentation (priority 0.5):
// - lib-docs/api-guide.md (0.90 * 0.5 = 0.45)
// - lib-docs/examples/authentication.md (0.87 * 0.5 = 0.44)
// - lib-docs/best-practices.md (0.83 * 0.5 = 0.42)
//
// Max 3 documentation results
```

**Key Behaviors:**

1. **Default Exclusion:** Reference and documentation repos excluded from default search
2. **Priority Weighting:** Your code (1.0) > Libraries (0.8) > References (0.6) > Docs (0.5)
3. **Result Limits:** Max 5 reference results, max 3 documentation results per query
4. **Grouping:** Results grouped by repository type in output
5. **Version Tracking:** Reference repos track version, skip re-index if unchanged

---

## 4. Retrieval Pipeline (Multi-Stage)

**Query Input:** User's natural language question or code snippet

> **Note:** This section describes the **base 4-stage retrieval pipeline** for single-repository search. For **multi-project architectures** (multiple repos, monorepos, microservices), see [Section 1.5: Multi-Project Architecture](#15-multi-project-architecture) which documents the **enhanced 7-stage pipeline** with scope filtering, API contract enrichment, and cross-repository dependency traversal.

### Base Retrieval Pipeline (Single Repository)

The following 4-stage pipeline is used for single-repository searches and as the foundation for multi-project retrieval:

### Stage 1: File-Level Retrieval (Broad)

```sql
-- Find top 30 most relevant files (more candidates for accuracy)
SELECT
    file_path,
    file_summary,
    1 - (summary_embedding <=> query_embedding) as similarity
FROM code_files
WHERE 1 - (summary_embedding <=> query_embedding) > 0.70  -- Minimum threshold
ORDER BY summary_embedding <=> query_embedding
LIMIT 30; -- Increased from 20 for better coverage
```

### Stage 2: Chunk-Level Retrieval (Precise)

```sql
-- Within top files, find specific code chunks
-- Retrieve more candidates for better filtering (100 instead of 50)
SELECT
    c.file_path,
    c.chunk_content,
    c.start_line,
    c.end_line,
    c.chunk_type,
    c.metadata,
    1 - (c.embedding <=> query_embedding) as similarity
FROM code_chunks c
WHERE c.file_path = ANY(top_files_from_stage1)
  AND 1 - (c.embedding <=> query_embedding) > 0.75  -- Higher threshold for accuracy (0.75 vs 0.7)
ORDER BY c.embedding <=> query_embedding
LIMIT 100; -- Retrieve more candidates, filter after deduplication
```

### Stage 3: Symbol Resolution (Dependencies)

```sql
-- For each retrieved chunk, resolve imported symbols
SELECT DISTINCT
    s.symbol_name,
    s.file_path,
    s.line_number,
    s.definition
FROM code_symbols s
WHERE s.symbol_name = ANY(extracted_symbols_from_chunks)
ORDER BY s.symbol_name;
```

### Stage 4: Import Chain Expansion

```
For top N files (N=5-10):
1. Extract all imports from code_files.imports
2. If imported file in indexed repo:
   - Fetch its file summary
   - Fetch specific exported symbol definitions
3. Build import dependency graph
4. Limit traversal depth (default: 3 levels)
   - Level 1: Files directly retrieved
   - Level 2: Their immediate imports
   - Level 3: Second-order imports
   - Stop after depth 3 to prevent runaway expansion
5. Track visited files to avoid circular imports (A→B→A)
6. Mark truncated chains with metadata flag
```

### Stage 5: Deduplication

```
Problem: Utility functions/patterns repeated across files pollute results

Strategy (Post-Ranking):
1. After retrieval, compare chunks pairwise
2. Calculate similarity between chunk embeddings
3. If cosine similarity >0.92: consider duplicates (stricter for accuracy)
4. Keep highest-scoring chunk, discard others
5. Mark discarded chunks with "similar_to" reference
6. Result: Cleaner, non-redundant context for Claude

Alternative: Signature-based dedup
- Hash function signatures (name + parameters)
- Deduplicate exact signature matches during indexing
- Faster but less flexible than embedding-based

Note: Lower threshold (0.92 vs 0.95) catches more near-duplicates
- Better accuracy at cost of potentially missing legitimate variations
- Recommended for accuracy-focused use case
```

---

## 5. Context Assembly for Claude Code

### Context Window Management

```
Token Budget Strategy:
1. Estimate tokens for all retrieved chunks (4 chars ≈ 1 token)
2. Sum total token count from chunk.token_count field
3. Warn if total exceeds 100k tokens (no hard limit - user decides)
4. Priority ranking by relevance score
5. For oversized chunks:
   - Include first 50 lines + last 50 lines
   - Add "...truncated N lines..." marker
   - Preserve function signatures and key logic

Warning Format:
⚠️ Context size: 120,547 tokens (exceeds 100k - may impact performance)
Showing top 30 most relevant locations. Consider narrowing query.
```

### Output Structure

```json
{
  "query": "user's question",
  "warnings": [
    {
      "type": "context_size",
      "severity": "warning",
      "message": "Context size: 127,843 tokens (exceeds 100k)",
      "suggestion": "Consider narrowing query or reducing max_snippets parameter"
    }
  ],
  "metadata": {
    "total_tokens": 127843,
    "files_retrieved": 12,
    "chunks_retrieved": 35,
    "chunks_deduplicated": 8,
    "import_depth_reached": 3,
    "query_time_ms": 420
  },
  "context": {
    "relevant_files": [
      {
        "path": "src/auth/login.ts",
        "summary": "Handles user authentication logic",
        "relevance_score": 0.92,
        "total_lines": 245,
        "language": "typescript",
        "file_hash": "a3f2c8..."
      }
    ],
    "code_locations": [
      {
        "file": "src/auth/login.ts",
        "lines": "45-67",
        "relevance_score": 0.89,
        "chunk_type": "function",
        "context": "function authenticateUser(...)",
        "token_count": 287
      }
    ],
    "imports": {
      "src/auth/login.ts": [
        {
          "symbol": "hashPassword",
          "from": "src/utils/crypto.ts",
          "line": 12,
          "definition": "export function hashPassword(plain: string): string",
          "depth": 1
        }
      ]
    },
    "code_snippets": [
      {
        "file": "src/auth/login.ts",
        "lines": "45-67",
        "code": "function authenticateUser(username: string, password: string): Promise<User> {\n  const hashedInput = hashPassword(password);\n  ...\n}",
        "symbols": ["authenticateUser", "hashPassword", "User"],
        "token_count": 287,
        "truncated": false
      }
    ]
  }
}
```

### Context Formatting for Claude

````markdown
⚠️ **Context Size Warning** Total tokens: 127,843 (exceeds 100k recommended limit) Files: 12 | Code
locations: 35 | Deduplicated: 8 chunks Query time: 420ms

---

# Relevant Code Context

## Files (ranked by relevance)

1. `src/auth/login.ts` (score: 0.92) - Handles user authentication logic [245 lines]
2. `src/utils/crypto.ts` (score: 0.85) - Password hashing utilities [189 lines]

## Key Code Locations

### src/auth/login.ts:45-67 (function: authenticateUser) [287 tokens]

```typescript
function authenticateUser(username: string, password: string): Promise<User> {
  const hashedInput = hashPassword(password);
  const user = await db.users.findOne({ username });
  if (!user || user.password !== hashedInput) {
    throw new AuthError('Invalid credentials');
  }
  return user;
}
```

## Dependencies & Imports (depth: 3)

- `hashPassword` from `src/utils/crypto.ts:12` [depth 1]
  ```typescript
  export function hashPassword(plain: string): string;
  ```
- `bcrypt` from `node_modules/bcrypt` [depth 2] External dependency - not expanded
````

---

## 6. MCP Tools Design

> **Note:** This section describes the **base MCP tools** for single-repository use. For **multi-project support** (multiple repos, monorepos, microservices), see [Section 1.5: Multi-Project Architecture - MCP Tools](#mcp-tools-with-multi-project-support) which documents:
> - Updated `search_codebase` with scope configuration (global, repository, service, boundary-aware)
> - New `search_api_contracts` tool for searching REST/GraphQL/gRPC APIs
> - New `list_indexed_repos` tool for listing all indexed repositories
> - Updated `index_repository` with multi-project parameters

### Base MCP Tools (Single Repository)

### Tool 1: `search_codebase`

```typescript
{
  name: "search_codebase",
  description: "Semantic search across codebase with multi-stage retrieval",
  inputSchema: {
    query: string,              // Natural language or code snippet
    max_files: number,          // Default: 15 (more candidates for accuracy)
    max_snippets: number,       // Default: 25 (more context for accuracy)
    include_imports: boolean,   // Default: true
    import_depth: number,       // Default: 3 (max levels to traverse)
    dedup_threshold: number,    // Default: 0.92 (stricter for accuracy)
    similarity_threshold: number // Default: 0.75 (higher for quality)
  },
  returns: "Structured context with files, locations, imports, code snippets. Includes token count warning if >100k."
}
```

### Tool 2: `get_file_context`

```typescript
{
  name: "get_file_context",
  description: "Get full context for a specific file including dependencies",
  inputSchema: {
    file_path: string,
    include_callers: boolean,   // Find what calls this file's exports
    include_callees: boolean,   // Find what this file imports
    import_depth: number        // Default: 3 (max traversal depth)
  }
}
```

### Tool 3: `find_symbol_definition`

```typescript
{
  name: "find_symbol_definition",
  description: "Locate definition and usages of a function/class/variable",
  inputSchema: {
    symbol_name: string,
    include_usages: boolean
  }
}
```

### Tool 4: `index_repository`

```typescript
{
  name: "index_repository",
  description: "Index or re-index a codebase",
  inputSchema: {
    repo_path: string,
    incremental: boolean,       // Default: true - only update changed files
    languages: string[],        // Filter by language (empty = all)
    include_markdown: boolean,  // Default: false - skip .md files
    respect_gitignore: boolean, // Default: true
    max_file_size: number,      // Default: 5000 lines (skip larger files)
    summary_method: string      // 'llm' | 'rule-based' (default: 'llm' for accuracy)
  },
  returns: "Indexing progress and statistics. Shows HNSW build progress for large indexes."
}
```

---

## 7. Implementation Priorities

### Phase 1: Core RAG (Week 1)

- PostgreSQL schema setup with file_hash and token_count
- File discovery with gitignore respect and filtering
- Basic indexing: file walking, SHA256 hashing
- Tree-sitter parsing with regex fallback
- LLM-based file summary generation (qwen2.5-coder:1.5b, primary method)
- Embedding generation pipeline (Ollama integration)
- Stage 1+2 retrieval (files + chunks) with accuracy settings (ef_search=300)
- Incremental update logic (hash comparison)

### Phase 2: Symbol Resolution (Week 2)

- Symbol extraction and indexing
- Import chain analysis with depth limits (max: 3)
- Stage 3+4 retrieval (symbols + imports)
- Large file handling (>5000 lines)
- Deduplication strategy (post-ranking, threshold: 0.95)

### Phase 3: MCP Integration (Week 3)

- MCP server with 4 core tools
- Context formatter for Claude Code
- Token counting and 100k warning system
- Testing with real queries
- HNSW index progress tracking

### Phase 4: Optimization (Week 4)

- Query caching
- Incremental indexing with file watching
- Performance tuning (HNSW parameters fine-tuning)
- Rule-based summary fallback (when LLM unavailable)
- Handle edge cases (minified code, generated files)
- Deleted file cleanup automation
- Batch processing optimizations for LLM summaries

---

## 8. Key Technical Decisions

### Embedding Model

**mxbai-embed-large via Ollama**

- 1024 dimensions
- Good code understanding
- Local, no API costs

### File Summary Generation

**LLM-based (primary) + Rule-based fallback**

- LLM: qwen2.5-coder:1.5b or 3b on first 100 lines (preferred, high quality)
- Rule-based fallback: Extract top comment + exports (only if LLM unavailable)
- Single sentence format: "This file does X"
- Accuracy priority: Always use LLM when available

### Chunking

**Tree-sitter based (syntax-aware) with fallback**

- Primary: Tree-sitter respects function/class boundaries
- Fallback: Sliding window (200 lines, 20-line overlap) for unsupported languages
- Includes surrounding context
- Metadata-rich (token counts, line ranges)
- Special handling for files >1000 lines

### Vector Search

**pgvector with HNSW (Accuracy-optimized)**

- Single database (simpler ops than Qdrant)
- `hnsw.ef_search = 300` for maximum accuracy
- `hnsw.ef_construction = 200` for higher quality index
- Cosine distance metric
- Build time: 15-45 minutes for 1M vectors (show progress)
- Trade longer build/query time for better results

### Incremental Updates

**Hash-based change detection**

- SHA256 per file for change detection
- Re-index only changed files
- Automatic deleted file cleanup
- Sub-second re-index for small changes

### Import Depth

**Maximum 3 levels (default)**

- Prevents runaway import chains
- Circular import detection
- Truncation markers for UI feedback

### Deduplication

**Post-ranking, similarity threshold 0.92**

- Compare chunk embeddings after retrieval
- Lower threshold (0.92) catches more near-duplicates for better accuracy
- Keep highest-scoring duplicate
- Prevents utility function pollution
- May filter some legitimate variations (acceptable for accuracy priority)

### Retrieval Settings

**Accuracy-optimized defaults**

- Similarity threshold: 0.75 (higher quality results)
- Max files: 15 (more candidates)
- Max snippets: 25 (richer context)
- Retrieve 100 candidates before dedup/filtering
- Prioritize precision over recall

### Context Window

**Soft limit with warnings**

- Warn at 100k tokens (no hard limit)
- Token estimation: ~4 chars = 1 token
- Priority ranking by relevance
- Smart truncation for oversized chunks

### File Filtering

**Respect gitignore + common patterns**

- Parse and apply .gitignore rules
- Skip: node_modules, dist, build, .min.js, package-lock.json
- Skip: .md files by default (configurable)
- Skip: files >5000 lines (index structure only)
- Skip: binary files

---

## Expected Output Flow

```
User Query: "How does authentication work?"
    ↓
Stage 1: Find relevant files (hash-based cache check)
    → src/auth/login.ts (0.92)
    → src/auth/session.ts (0.87)
    → src/middleware/auth.ts (0.84)
    ↓
Stage 2: Find specific code chunks (with token counting)
    → login.ts:45-67 - authenticateUser() (0.89, 287 tokens)
    → login.ts:120-145 - validateToken() (0.85, 312 tokens)
    → session.ts:30-55 - createSession() (0.83, 265 tokens)
    ↓
Stage 3: Resolve symbols
    → hashPassword from utils/crypto.ts:12
    → User from types/models.ts:8
    → AuthError from errors/auth.ts:15
    ↓
Stage 4: Expand imports (depth 3, circular detection)
    → crypto.ts imports bcrypt (depth 2, external - stop)
    → models.ts defines User interface (depth 2)
    → auth.ts defines error hierarchy (depth 2)
    ↓
Stage 5: Deduplication (threshold 0.95)
    → Found 3 identical `formatDate()` implementations
    → Kept highest-scoring version from utils/date.ts
    → Discarded 2 duplicates, saved ~400 tokens
    ↓
Token Count & Warning:
    → Total: 127,843 tokens
    → ⚠️ Exceeds 100k threshold - warn user
    ↓
Output: Formatted context with all components
    → Warnings displayed prominently
    → Metadata included (files, chunks, dedup count, query time)
    → Ready for Claude Code
```

---

## Edge Cases & Improvements

### Incremental Indexing Flow

```
User triggers re-index:
1. Walk directory, compute file hashes
2. Compare with stored hashes in DB
3. Unchanged files: Skip
4. Changed files: Delete old chunks → Re-parse → Re-embed → Insert
5. Deleted files: Remove from all tables
6. New files: Full indexing pipeline
7. Rebuild HNSW index only if >10% data changed
Result: 10k file repo re-indexes in seconds instead of minutes
```

### Large File Strategy

```
File size categories:
- <1000 lines: Normal chunking
- 1000-5000 lines: Section-based chunking
  → Detect major boundaries (classes, modules)
  → Chunk within sections
- >5000 lines: Structure-only indexing
  → Index file summary + exports
  → Skip detailed chunks (too noisy)
  → Flag as "large file - partial index"
```

### Tree-sitter Fallback Triggers

```
Use regex-based chunking when:
- Language not supported by tree-sitter
- Syntax errors prevent parsing
- File is badly formatted/minified
- Fallback strategy:
  → 200-line sliding window, 20-line overlap
  → Regex detect function starts (language-specific)
  → Break at blank lines/comments when possible
  → Mark chunk_type: 'fallback'
```

### Deduplication Examples

```
Scenario: 10 files each have identical `formatDate()` utility

Without dedup:
- All 10 versions appear in results
- Wastes context window space
- Confuses Claude with redundancy

With dedup (threshold 0.92, accuracy-focused):
- Keep highest-scoring version (most relevant file)
- Discard other 9 (stricter threshold catches more)
- Add metadata: "similar_to: [file1, file2, ...]"
- Result: Clean, focused context
- Trade-off: May occasionally filter legitimate variations
  (acceptable for accuracy-first approach)
```

### Context Window Warning System

```
Token calculation:
1. Sum chunk.token_count for all retrieved chunks
2. Add overhead: file paths, metadata (~5% of total)
3. Total = data_tokens + overhead

Warning levels:
- <50k tokens: ✓ Optimal (no warning)
- 50k-100k: ℹ️ Large context (acceptable)
- >100k: ⚠️ Very large context - may impact performance
- No hard limit - user decides whether to proceed

Output:
⚠️ Context size: 127,843 tokens (exceeds 100k)
Consider narrowing query or reducing max_snippets parameter.
```

### File Filtering Decision Tree

```
Should we index .md files?

Skip .md (default):
✓ Code-focused RAG (most use cases)
✓ Faster indexing
✓ Less noise in results

Include .md (optional):
✓ When docs contain code examples
✓ When README.md has architecture diagrams
✓ API documentation with usage patterns

Recommendation:
- Skip by default
- Whitelist: README.md at repo root only
- Make configurable: include_markdown parameter
```

### Circular Import Handling

```
Scenario: A imports B, B imports C, C imports A

Detection:
1. Track visited files in Set during import expansion
2. Before fetching imports, check if already visited
3. If visited: Skip, mark as circular

Result:
imports: {
  "A.ts": ["B.ts"],
  "B.ts": ["C.ts"],
  "C.ts": ["A.ts (circular - not expanded)"]
}
```

### HNSW Build Progress

```
Problem: Building HNSW on 1M vectors takes 15-25 minutes
User sees: Nothing (looks frozen)

Solution: Progress tracking
1. Use IVFFlat index initially (fast build, slightly slower queries)
2. Show progress: "Building vector index: 45% (450k/1M vectors)"
3. After data insert complete, rebuild as HNSW in background
4. Allow queries during rebuild (use IVFFlat until HNSW ready)
5. Atomic swap: IVFFlat → HNSW when complete

Alternative: Batch progress updates every 10k vectors
```

---

## Performance Targets

### Indexing Performance (Accuracy Priority)

- **Initial indexing**: 300-600 files/minute (slower due to LLM summaries)
- **Incremental re-index**: <15 seconds for 100 changed files
- **HNSW build**: 15-45 minutes for 1M vectors (with high-quality settings + progress tracking)
- **Memory usage**: <3GB RAM for indexing (LLM + embeddings), <500MB for queries

### Query Performance (Accuracy Priority)

- **Typical query latency**: <800ms (slower but more accurate)
  - File-level retrieval: <150ms
  - Chunk-level retrieval: <350ms (more candidates, higher ef_search)
  - Symbol resolution: <150ms
  - Import expansion: <150ms (depth 3)
- **Cold start (first query)**: <3s (includes model warmup + higher computation)

### Accuracy Targets

- **Relevance**: >92% of top 10 results are highly relevant (vs 85% baseline)
- **Deduplication**: >97% of duplicate utilities caught (vs 95%)
- **File summary quality**:
  - LLM-based: 92-95% accurate (default)
  - Rule-based fallback: 70% accurate

### Scale Targets

- **Codebase size**: Handle 1M+ LoC efficiently
- **File count**: 50k+ files indexed
- **Concurrent queries**: 5-8 simultaneous searches (reduced for accuracy)
- **Context quality**: <2% noise in final assembled context (vs 5% baseline)

---

## Next Steps

### Development Environment Setup

1. **MCP Configuration**
   - Create/edit MCP `.json` file (see Section 2 for full reference)
   - Set environment variables for models and database
   - Choose accuracy-first or speed-first preset
2. **PostgreSQL + pgvector**
   - Install PostgreSQL 16+
   - Enable pgvector extension: `CREATE EXTENSION vector;`
   - Create database: `cindex_rag_codebase` (or name specified in config)

3. **Ollama Setup**
   - Install Ollama
   - Pull embedding model: `ollama pull mxbai-embed-large` (or configured model)
   - Pull LLM (required for accuracy): `ollama pull qwen2.5-coder:1.5b` or `qwen2.5-coder:3b`
   - Note: 3b model has better accuracy, 1.5b is faster

4. **TypeScript Environment** (for development)
   - Clone: `git clone https://github.com/gianged/cindex.git`
   - Initialize: `npm install`
   - Core dependencies:
     - `@modelcontextprotocol/sdk` - MCP server framework
     - `pg`, `pgvector` - PostgreSQL client and vector support
     - `tree-sitter` - Syntax-aware code parsing
     - `tree-sitter-typescript`, `tree-sitter-python` - Language parsers
   - Build: `npm run build`

### Initial Implementation Order

1. **Configuration setup** (Day 1)
   - Set up MCP `.json` file with environment variables
   - Configure embedding model, summary model, PostgreSQL connection
   - Test Ollama connectivity and model availability
   - Verify PostgreSQL connection

2. **Schema creation** (Day 1)
   - Run all CREATE TABLE statements
   - Set up indexes (defer HNSW for testing - use IVFFlat first)
   - Test with sample data

3. **File discovery** (Day 2)
   - Implement directory walker with gitignore support
   - File filtering logic (extensions, size limits)
   - SHA256 hashing for each file

4. **Chunking pipeline** (Day 3-4)
   - Tree-sitter integration for TypeScript/JavaScript
   - Regex fallback for unsupported languages
   - LLM-based file summary generation (using configured SUMMARY_MODEL)
   - Token counting for chunks

5. **Embedding generation** (Day 5)
   - Ollama API integration (using configured EMBEDDING_MODEL)
   - Batch processing (handle 100+ files)
   - Progress tracking

6. **Basic retrieval** (Day 6-7)
   - Stage 1: File-level search
   - Stage 2: Chunk-level search
   - Apply configured similarity thresholds
   - Test with small codebase (1k-5k LoC)

7. **Incremental updates** (Week 2 Day 1-2)
   - Hash comparison logic
   - Differential re-indexing
   - Deleted file cleanup

8. **Symbol resolution** (Week 2 Day 3-4)
   - Extract symbols during chunking
   - Build symbol index
   - Import chain traversal with depth limits

9. **MCP server** (Week 3)
   - Implement 4 core tools
   - Context formatting for Claude Code
   - Token warning system
   - Read configuration from environment variables

10. **Optimization** (Week 4)

- HNSW index rebuild (replace IVFFlat)
- Deduplication implementation (using configured threshold)
- Query caching
- Performance tuning

### Testing Strategy

- **Unit tests**: Each stage independently (chunking, embedding, retrieval)
- **Integration tests**: End-to-end query flow
- **Scale tests**:
  - Small: 1k LoC codebase
  - Medium: 50k LoC codebase
  - Large: 200k-1M LoC codebase (your ERP/blog)
- **Edge cases**: Circular imports, large files, minified code

### Success Criteria

- ✅ Index 200k LoC codebase in <45 minutes (slower due to LLM summaries)
- ✅ Re-index 100 changed files in <15 seconds
- ✅ Query returns highly relevant results in <800ms (accuracy over speed)
- ✅ >92% relevance in top 10 results (vs 85% baseline)
- ✅ Context stays under 150k tokens for typical queries
- ✅ Deduplication catches >97% of duplicate utilities (stricter threshold)
- ✅ <2% noise in final context (vs 5% baseline)
- ✅ Works with Claude Code seamlessly

---

## Summary of Key Improvements

### Project Information

- **Package Name:** `@gianged/cindex`
- **Author:** gianged
- **License:** MIT
- **Repository:** https://github.com/gianged/cindex
- **NPM:** https://www.npmjs.com/package/@gianged/cindex

### Critical Features Added

1. **Configurable Models** - Embedding and summary models via environment variables in MCP `.json`
2. **Flexible Database Connection** - PostgreSQL host/port/credentials fully configurable
3. **Incremental Indexing** - Hash-based change detection prevents full re-indexing
4. **File Filtering** - Respects gitignore, skips .md by default, handles large files
5. **Tree-sitter Fallback** - Regex-based chunking when tree-sitter fails
6. **Import Depth Limits** - Max 3 levels to prevent runaway expansion
7. **Deduplication** - Post-ranking similarity check (threshold 0.92)
8. **Context Window Management** - Token counting with 100k warning (no hard limit)
9. **File Summary Generation** - LLM-based (configurable model) with rule-based fallback
10. **Progress Tracking** - HNSW build progress visible to user
11. **Tunable Accuracy/Speed** - All thresholds configurable via environment

### Schema Enhancements

- Added `file_hash` for change detection
- Added `token_count` for context budget management
- Added indexes for performance optimization

### Configuration Options

**All settings configurable via environment variables (see Section 2 for details)**

**Accuracy-Optimized Defaults:**

- `EMBEDDING_MODEL` (default: 'mxbai-embed-large')
- `EMBEDDING_DIMENSIONS` (default: 1024)
- `SUMMARY_MODEL` (default: 'qwen2.5-coder:1.5b')
- `OLLAMA_HOST` (default: 'http://localhost:11434')
- `POSTGRES_HOST` (default: 'localhost')
- `POSTGRES_PORT` (default: 5432)
- `POSTGRES_DB` (default: 'cindex_rag_codebase')
- `HNSW_EF_SEARCH` (default: 300)
- `HNSW_EF_CONSTRUCTION` (default: 200)
- `SIMILARITY_THRESHOLD` (default: 0.75)
- `DEDUP_THRESHOLD` (default: 0.92)
- `import_depth` (default: 3)
- `include_markdown` (default: false)
- `respect_gitignore` (default: true)
- `max_file_size` (default: 5000 lines)

**Performance Trade-offs:**

- Slower indexing (LLM summaries + higher quality HNSW)
- Slower queries (~800ms vs 500ms)
- Higher accuracy (>92% vs >85% relevance)
- Lower noise (<2% vs <5%)

### Output Improvements

- Token count warnings when >100k
- Metadata: query time, dedup count, depth reached
- Structured warnings array
- Truncation markers for large chunks
- Import depth labels

This plan now comprehensively addresses all edge cases for production use with 1M+ LoC codebases.

**Accuracy-First Configuration:**

- All defaults optimized for maximum accuracy over speed
- LLM-based summaries (qwen2.5-coder:1.5b/3b)
- Higher HNSW quality settings (ef_search=300, ef_construction=200)
- Stricter similarity thresholds (0.75 retrieval, 0.92 dedup)
- More retrieval candidates (15 files, 25 snippets, 100 chunks)
- Expected: 60% slower but >92% accuracy vs baseline 85%

**Package Files Included:**

- `README.md` - User-facing documentation and quick start
- `package.json` - NPM package configuration
- `tsconfig.json` - TypeScript compiler configuration
- `.gitignore` - Git ignore patterns
- `.npmignore` - NPM publish ignore patterns
- `LICENSE` - MIT license
- `database.sql` - PostgreSQL schema
- `docs/overview.md` - This document - complete technical documentation
- `docs/syntax.md` - Syntax reference for MCP SDK, pgvector, and tree-sitter
- `CLAUDE.md` - Claude Code internal instructions (not for end users)
- `CONTRIBUTING.md` - Contribution guidelines
- `src/` - TypeScript source code (to be implemented)
- `dist/` - Compiled JavaScript (generated on build)

**Publishing to NPM:**

```bash
npm login
npm publish --access public
```
