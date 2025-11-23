# CIndex Syntax Reference

This document contains syntax references for the key libraries used in the CIndex project.

## Table of Contents

- [Model Context Protocol (MCP) TypeScript SDK](#model-context-protocol-mcp-typescript-sdk)
- [pgvector](#pgvector)
- [tree-sitter](#tree-sitter)

---

## Model Context Protocol (MCP) TypeScript SDK

### Basic Server Setup

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

const server = new McpServer({
  name: 'server-name',
  version: '1.0.0',
});
```

### Register Tools

```typescript
server.registerTool(
  'tool-name',
  {
    title: 'Tool Title',
    description: 'Tool description',
    inputSchema: {
      param1: z.string(),
      param2: z.number(),
    },
    outputSchema: {
      result: z.string(),
      success: z.boolean(),
    },
  },
  async ({ param1, param2 }) => {
    const output = { result: 'value', success: true };
    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
      structuredContent: output,
    };
  }
);
```

### Register Resources

#### Static Resource

```typescript
server.registerResource(
  'resource-name',
  'app://resource-uri',
  {
    title: 'Resource Title',
    description: 'Resource description',
    mimeType: 'application/json',
  },
  async (uri) => ({
    contents: [
      {
        uri: uri.href,
        text: JSON.stringify({ data: 'value' }),
      },
    ],
  })
);
```

#### Dynamic Resource with Template

```typescript
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

server.registerResource(
  'resource-name',
  new ResourceTemplate('users://{userId}/profile', { list: undefined }),
  {
    title: 'User Profile',
    description: 'Dynamic user profile data',
  },
  async (uri, { userId }) => {
    const data = { id: userId, name: `User ${userId}` };
    return {
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(data),
        },
      ],
    };
  }
);
```

#### Resource with Context-Aware Completion

```typescript
server.registerResource(
  'repository',
  new ResourceTemplate('github://repos/{owner}/{repo}', {
    list: undefined,
    complete: {
      owner: (value) => {
        return ['microsoft', 'google', 'facebook'].filter((o) => o.startsWith(value));
      },
      repo: (value, context) => {
        const owner = context?.arguments?.['owner'];
        if (owner === 'microsoft') {
          return ['vscode', 'typescript'].filter((r) => r.startsWith(value));
        }
        return ['repo1', 'repo2'].filter((r) => r.startsWith(value));
      },
    },
  }),
  {
    title: 'GitHub Repository',
    description: 'Repository data',
  },
  async (uri, { owner, repo }) => ({
    contents: [
      {
        uri: uri.href,
        text: `Repository: ${owner}/${repo}`,
      },
    ],
  })
);
```

### Register Prompts

```typescript
server.registerPrompt(
  'prompt-name',
  {
    title: 'Prompt Title',
    description: 'Prompt description',
    argsSchema: { message: z.string() },
  },
  ({ message }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Process this: ${message}`,
        },
      },
    ],
  })
);
```

### Dynamic Tool Management

```typescript
// Register tool
const tool = server.registerTool(
  'tool-name',
  {
    /* config */
  },
  async (params) => {
    // Implementation
  }
);

// Disable tool (won't show up in listTools)
tool.disable();

// Enable tool (triggers notifications/tools/list_changed)
tool.enable();

// Update tool schema
tool.update({
  inputSchema: { newParam: z.string() },
});

// Remove tool completely (triggers notification)
tool.remove();
```

### Return Resource Links from Tools

```typescript
server.registerTool(
  'list-files',
  {
    title: 'List Files',
    inputSchema: { pattern: z.string() },
    outputSchema: {
      count: z.number(),
      files: z.array(z.object({ name: z.string(), uri: z.string() })),
    },
  },
  async ({ pattern }) => {
    const output = {
      count: 2,
      files: [{ name: 'README.md', uri: 'file:///project/README.md' }],
    };
    return {
      content: [
        { type: 'text', text: JSON.stringify(output) },
        {
          type: 'resource_link',
          uri: 'file:///project/README.md',
          name: 'README.md',
          mimeType: 'text/markdown',
          description: 'A README file',
        },
      ],
      structuredContent: output,
    };
  }
);
```

### User Input Elicitation

```typescript
server.registerTool(
  'book-restaurant',
  {
    /* schema */
  },
  async ({ restaurant, date, partySize }) => {
    const available = await checkAvailability(restaurant, date, partySize);

    if (!available) {
      const result = await server.server.elicitInput({
        message: `No tables available. Check alternatives?`,
        requestedSchema: {
          type: 'object',
          properties: {
            checkAlternatives: {
              type: 'boolean',
              title: 'Check alternative dates',
            },
          },
          required: ['checkAlternatives'],
        },
      });

      if (result.action === 'accept' && result.content?.checkAlternatives) {
        // Handle alternative logic
      }
    }
  }
);
```

### Low-Level Server API

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'server-name', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } }
);

// Handle tool listing
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'multiply',
        description: 'Multiply two numbers',
        inputSchema: {
          type: 'object',
          properties: {
            a: { type: 'number' },
            b: { type: 'number' },
          },
          required: ['a', 'b'],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'multiply') {
    const { a, b } = request.params.arguments as { a: number; b: number };
    return {
      content: [{ type: 'text', text: `Result: ${a * b}` }],
    };
  }
  throw new Error('Unknown tool');
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

### HTTP Transport

```typescript
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  res.on('close', () => transport.close());
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000, () => {
  console.log('MCP Server running on http://localhost:3000/mcp');
});
```

### MCP Client

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['server.js'],
});

const client = new Client({
  name: 'client-name',
  version: '1.0.0',
});

await client.connect(transport);

// List prompts
const prompts = await client.listPrompts();

// Get a prompt
const prompt = await client.getPrompt({
  name: 'example-prompt',
  arguments: { arg1: 'value' },
});

// List resources
const resources = await client.listResources();

// Read a resource
const resource = await client.readResource({
  uri: 'file:///example.txt',
});

// Call a tool
const result = await client.callTool({
  name: 'example-tool',
  arguments: { arg1: 'value' },
});
```

---

## pgvector

### Distance Operators

```sql
-- L2 distance (Euclidean)
SELECT * FROM items ORDER BY embedding <-> '[3,1,2]' LIMIT 5;

-- Inner product (best for normalized vectors)
SELECT * FROM items ORDER BY embedding <#> '[3,1,2]' LIMIT 5;

-- Cosine distance
SELECT * FROM items ORDER BY embedding <=> '[3,1,2]' LIMIT 5;

-- Calculate cosine similarity
SELECT 1 - (embedding <=> '[3,1,2]') AS cosine_similarity FROM items;
```

### Create Indexes

#### HNSW Index (Recommended)

```sql
-- L2 distance
CREATE INDEX ON items USING hnsw (embedding vector_l2_ops);

-- Inner product
CREATE INDEX ON items USING hnsw (embedding vector_ip_ops);

-- Cosine distance
CREATE INDEX ON items USING hnsw (embedding vector_cosine_ops);

-- With custom parameters
CREATE INDEX ON items USING hnsw (embedding vector_l2_ops)
WITH (m = 16, ef_construction = 64);
```

#### IVFFlat Index

```sql
-- L2 distance
CREATE INDEX ON items USING ivfflat (embedding vector_l2_ops)
WITH (lists = 100);

-- Inner product
CREATE INDEX ON items USING ivfflat (embedding vector_ip_ops)
WITH (lists = 100);

-- Cosine distance
CREATE INDEX ON items USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

### Subvector Indexing

```sql
-- Create index on first 512 dimensions
CREATE INDEX ON documents
USING hnsw ((subvector(embedding, 1, 512)::vector(512)) vector_cosine_ops);

-- Query using subvector
SELECT id, content FROM documents
ORDER BY subvector(embedding, 1, 512)::vector(512) <=>
         subvector('[0.1,0.2,...]'::vector, 1, 512)
LIMIT 50;

-- Re-rank with full vectors
SELECT * FROM (
    SELECT id, content, embedding
    FROM documents
    ORDER BY subvector(embedding, 1, 512)::vector(512) <=>
             subvector('[0.1,0.2,...]'::vector, 1, 512)
    LIMIT 100
) AS candidates
ORDER BY embedding <=> '[0.1,0.2,...]'
LIMIT 10;
```

### Filtered Vector Search

```sql
-- Create B-tree index on filter column
CREATE INDEX ON documents (metadata);
CREATE INDEX ON documents ((metadata->>'category'));

-- Query with filter
SELECT id, content, embedding <-> '[0.3,0.4,0.5]' AS distance
FROM documents
WHERE metadata->>'category' = 'tutorial'
ORDER BY distance
LIMIT 5;

-- Multi-column filter
CREATE INDEX ON documents (user_id, created_at);
SELECT id, content FROM documents
WHERE user_id = 123 AND created_at > '2024-01-01'
ORDER BY embedding <-> '[0.2,0.3,0.4,0.5]'
LIMIT 10;

-- Partial index for specific categories
CREATE INDEX ON documents USING hnsw (embedding vector_l2_ops)
WHERE (metadata->>'category' = 'research');
```

### Partitioned Tables

```sql
-- Create partitioned table
CREATE TABLE documents (
    id bigserial,
    content text,
    embedding vector(1536),
    category text
) PARTITION BY LIST(category);

-- Create partitions
CREATE TABLE documents_tutorial PARTITION OF documents
FOR VALUES IN ('tutorial');

CREATE TABLE documents_research PARTITION OF documents
FOR VALUES IN ('research');

-- Index each partition
CREATE INDEX ON documents_tutorial USING hnsw (embedding vector_l2_ops);
CREATE INDEX ON documents_research USING hnsw (embedding vector_l2_ops);
```

### Hybrid Search (Full-Text + Vector)

```sql
-- Add tsvector column
ALTER TABLE documents ADD COLUMN textsearch tsvector;
UPDATE documents SET textsearch = to_tsvector('english', content);
CREATE INDEX ON documents USING gin(textsearch);

-- Full-text search
SELECT id, content, ts_rank_cd(textsearch, query) AS text_rank
FROM documents, plainto_tsquery('postgresql tutorial') query
WHERE textsearch @@ query
ORDER BY text_rank DESC
LIMIT 10;

-- Hybrid search with reciprocal rank fusion
WITH text_search AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(textsearch, query) DESC) AS rank
    FROM documents, plainto_tsquery('postgresql tutorial') query
    WHERE textsearch @@ query
    LIMIT 20
),
vector_search AS (
    SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <-> '[0.1,0.2,0.3]') AS rank
    FROM documents
    LIMIT 20
)
SELECT COALESCE(t.id, v.id) AS id,
       1.0 / (60 + COALESCE(t.rank, 1000)) +
       1.0 / (60 + COALESCE(v.rank, 1000)) AS score
FROM text_search t
FULL OUTER JOIN vector_search v ON t.id = v.id
ORDER BY score DESC
LIMIT 10;
```

### Query Optimization

```sql
-- Use index (correct)
ORDER BY embedding <=> '[3,1,2]' LIMIT 5;

-- Does NOT use index (incorrect)
ORDER BY 1 - (embedding <=> '[3,1,2]') DESC LIMIT 5;
```

---

## tree-sitter

**Current Version:** 0.21.1 (Node.js bindings) **Language Parsers:** 0.21.x - 0.22.x

> **Note:** The API is stable across 0.21.x, 0.22.x, and 0.25.x versions. All examples below are
> compatible with tree-sitter 0.21.1.

### Basic Parser Setup (Node.js)

```typescript
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';

const parser = new Parser();
parser.setLanguage(JavaScript);

const sourceCode = 'let x = 1; console.log(x);';
const tree = parser.parse(sourceCode);
```

### Parse from Custom Data Structure

```typescript
const sourceLines = ['let x = 1;', 'console.log(x);'];

const tree = parser.parse((index, position) => {
  let line = sourceLines[position.row];
  if (line) {
    return line.slice(position.column);
  }
});
```

### Inspect Syntax Tree

```typescript
// Print tree structure
console.log(tree.rootNode.toString());

// Output example:
// (program
//   (lexical_declaration
//     (variable_declarator (identifier) (number)))
//   (expression_statement
//     (call_expression
//       (member_expression (identifier) (property_identifier))
//       (arguments (identifier)))))

// Access specific nodes
const callExpression = tree.rootNode.child(1).firstChild;
console.log(callExpression);

// Output example:
// {
//   type: 'call_expression',
//   startPosition: {row: 0, column: 16},
//   endPosition: {row: 0, column: 30},
//   startIndex: 0,
//   endIndex: 30
// }
```

### Node Traversal (C API)

```c
// Access named children (skips anonymous nodes)
TSNode ts_node_named_child(TSNode, uint32_t);
uint32_t ts_node_named_child_count(TSNode);
TSNode ts_node_next_named_sibling(TSNode);
TSNode ts_node_prev_named_sibling(TSNode);

// Descendant traversal
TSNode ts_node_descendant_for_index_wasm(const TSNode* node, uint32_t index);
TSNode ts_node_descendant_for_position_wasm(const TSNode* node, uint32_t index);
void ts_node_descendants_of_type_wasm(const TSNode* node, const char* type, uint32_t* count, TSNode* descendants);

// Child traversal
uint32_t ts_node_child_count_wasm(const TSNode* node);
TSNode ts_node_child_wasm(const TSNode* node, uint32_t index);
void ts_node_children_wasm(const TSNode* node, uint32_t* count, TSNode* children);
```

### Query Syntax

#### Basic Node Matching

```scheme
; Match binary expression with number literals
(binary_expression (number_literal) (number_literal))

; Match binary expression with a string literal
(binary_expression (string_literal))

; Match any node inside a call
(call (_) @call.inner)

; Match ERROR nodes (unrecognized text)
(ERROR) @error-node

; Match MISSING nodes (missing tokens)
(MISSING) @missing-node
```

#### Capture Nodes

```scheme
; Capture function name
(assignment_expression
  left: (identifier) @the-function-name
  right: (function))

; Capture class and method names
(class_declaration
  name: (identifier) @the-class-name
  body: (class_body
    (method_definition
      name: (property_identifier) @the-method-name)))
```

#### Grouping Sibling Nodes

```scheme
; Group comment and function declaration
(
  (comment)
  (function_declaration)
)

; Group numbers with commas (quantified)
(
  (number)
  ("," (number))*
)
```

### Installation

```bash
# Install core library (version 0.21.1)
npm install tree-sitter@^0.21.1

# Install language grammars (0.21.x compatible versions)
npm install tree-sitter-c@^0.21.4
npm install tree-sitter-cpp@^0.22.3
npm install tree-sitter-go@^0.21.2
npm install tree-sitter-java@^0.21.0
npm install tree-sitter-javascript@^0.21.4
npm install tree-sitter-python@^0.21.0
npm install tree-sitter-rust@^0.21.0
npm install tree-sitter-typescript@^0.21.2
```

**Version Compatibility:**

- All language parsers are tested and compatible with tree-sitter 0.21.1
- Using `^` allows patch updates within the same minor version
- If upgrading tree-sitter core, ensure all language parsers support the target version

---

## Additional Notes

### Performance Tips

#### pgvector

- Use HNSW indexes for better performance than IVFFlat
- Normalize vectors before using inner product operator
- Use subvector indexing for high-dimensional vectors
- Consider partitioning for large datasets with distinct categories
- Use partial indexes when filtering on specific values

#### tree-sitter

- Native Node.js bindings are ~2x faster than WASM
- Reuse parser instances when parsing multiple files
- Use named node traversal for AST-like navigation
- Query captures are efficient for pattern matching

### Common Patterns

#### MCP Server Structure

```
server/
 index.ts          # Server initialization
 tools/            # Tool implementations
 resources/        # Resource handlers
 prompts/          # Prompt templates
```

#### Vector Database Schema

```sql
CREATE TABLE documents (
    id bigserial PRIMARY KEY,
    content text NOT NULL,
    embedding vector(1536),
    metadata jsonb,
    created_at timestamp DEFAULT now()
);

CREATE INDEX ON documents USING hnsw (embedding vector_cosine_ops);
CREATE INDEX ON documents USING gin(metadata);
```

---

_Generated with Context7 for CIndex project_
