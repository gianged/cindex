# Contributing to cindex

Thank you for your interest in contributing to cindex! This document provides guidelines for contributing to the project.

## Development Setup

### Prerequisites

- Node.js 22+
- PostgreSQL 16+ with pgvector extension
- Ollama with required models
- Git

### Getting Started

1. **Fork and clone the repository:**

   ```bash
   git clone https://github.com/gianged/cindex.git
   cd cindex
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set up development database:**

   ```bash
   createdb cindex_rag_codebase_dev
   psql cindex_rag_codebase_dev < database.sql
   ```

4. **Create `.env` file:**

   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

5. **Build the project:**

   ```bash
   npm run build
   ```

6. **Run tests:**
   ```bash
   npm test
   ```

## Project Structure

```
cindex/
├── src/
│   ├── index.ts           # MCP server entry point
│   ├── indexing/          # Code indexing pipeline
│   │   ├── file-walker.ts
│   │   ├── chunker.ts
│   │   ├── embeddings.ts
│   │   └── summary.ts
│   ├── retrieval/         # Search and retrieval
│   │   ├── vector-search.ts
│   │   ├── symbol-resolver.ts
│   │   └── deduplicator.ts
│   ├── database/          # PostgreSQL client
│   │   ├── client.ts
│   │   └── queries.ts
│   ├── mcp/               # MCP tools
│   │   ├── search-codebase.ts
│   │   ├── get-file-context.ts
│   │   ├── find-symbol.ts
│   │   └── index-repository.ts
│   ├── config/            # Configuration
│   │   └── env.ts
│   └── utils/             # Utilities
│       ├── tree-sitter.ts
│       ├── ollama.ts
│       └── logger.ts
├── tests/                 # Test files
├── database.sql           # Database schema
├── package.json
├── tsconfig.json
└── README.md
```

## Development Workflow

### Making Changes

1. **Create a feature branch:**

   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes:**

   - Write clean, documented code
   - Follow TypeScript best practices
   - Add tests for new features
   - Update documentation as needed

3. **Test your changes:**

   ```bash
   npm run lint        # Check code style
   npm run format      # Auto-format code
   npm test            # Run tests
   npm run build       # Ensure it builds
   ```

4. **Commit your changes:**

   ```bash
   git add .
   git commit -m "feat: add new feature"
   ```

   Follow [Conventional Commits](https://www.conventionalcommits.org/):

   - `feat:` New feature
   - `fix:` Bug fix
   - `docs:` Documentation changes
   - `perf:` Performance improvements
   - `refactor:` Code refactoring
   - `test:` Test additions/changes
   - `chore:` Build/tooling changes

5. **Push and create a pull request:**
   ```bash
   git push origin feature/your-feature-name
   ```

### Code Style

- Use TypeScript strict mode
- Follow existing code formatting (Prettier)
- Add JSDoc comments for public APIs
- Keep functions small and focused
- Write self-documenting code

### Testing

- Write unit tests for new functions
- Add integration tests for features
- Test edge cases and error handling
- Aim for >80% code coverage

### Documentation

- Update README.md for user-facing changes
- Update implementation plan for architecture changes
- Add JSDoc comments for all exported functions
- Include usage examples in comments

## Areas for Contribution

### High Priority

- [ ] Implement MCP tools (search, index, etc.)
- [ ] Build indexing pipeline
- [ ] Create retrieval system
- [ ] Add comprehensive tests
- [ ] Performance optimization

### Features

- [ ] Web UI for browsing indexed code
- [ ] Support for more embedding models
- [ ] Query result caching
- [ ] Multi-repo support
- [ ] Git integration for auto re-indexing
- [ ] Code graph visualization
- [ ] Semantic code diff

### Improvements

- [ ] Better error handling and logging
- [ ] Progress bars for long operations
- [ ] Configuration validation
- [ ] Memory usage optimization
- [ ] Query performance profiling
- [ ] Better tree-sitter fallback logic

### Documentation

- [ ] Video tutorials
- [ ] Architecture diagrams
- [ ] API documentation
- [ ] Performance tuning guide
- [ ] Troubleshooting guide

## Reporting Issues

### Bug Reports

Include:

- Clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Environment (OS, Node version, PostgreSQL version)
- Error messages and logs
- Codebase size if relevant

### Feature Requests

Include:

- Clear description of the feature
- Use case and benefits
- Proposed implementation (if any)
- Alternatives considered

## Pull Request Process

1. **Ensure your PR:**

   - Has a clear title and description
   - References related issues
   - Passes all tests and linting
   - Updates relevant documentation
   - Has no merge conflicts

2. **Review process:**

   - Maintainer will review within 1-2 weeks
   - Address review feedback
   - Squash commits if requested
   - Keep PR scope focused

3. **After merge:**
   - Delete your feature branch
   - Update your fork's main branch

## Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers
- Accept constructive criticism
- Focus on what's best for the project
- Show empathy towards others

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Public or private harassment
- Publishing others' private information
- Unprofessional conduct

## Questions?

- Open a GitHub issue for technical questions
- Tag issues with `question` label
- Check existing issues first

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Acknowledgments

Thank you for contributing to cindex! Your efforts help make intelligent code search accessible to everyone.
