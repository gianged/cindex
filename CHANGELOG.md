# Changelog

## [1.2.0](https://github.com/gianged/cindex/compare/v1.1.0...v1.2.0) (2025-11-23)


### Features

* Refactor search functionality to combine documentation and reference repository code searches ([386cae5](https://github.com/gianged/cindex/commit/386cae5b735b0ccc4660fbceb0614ac0237799d2))

## [1.1.0](https://github.com/gianged/cindex/compare/v1.0.0...v1.1.0) (2025-11-23)


### Features

* Implement hybrid search capabilities for improved retrieval accuracy ([13f5469](https://github.com/gianged/cindex/commit/13f5469a1ee8be403dd4d224e9d0f537504b8e3a))

## 1.0.0 (2025-11-22)


### Features

* add documentation indexing and search tools ([3bb93a0](https://github.com/gianged/cindex/commit/3bb93a0d93db57c28d1676914add8cad9106222c))
* Add initial project structure with MCP server implementation, pgvector support, and tree-sitter integration ([f757cee](https://github.com/gianged/cindex/commit/f757cee1b9090e9f10607c29a24256d198d2ec57))
* Add phases 3 to 6 for embedding, retrieval, MCP server, and optimization ([206acc0](https://github.com/gianged/cindex/commit/206acc0baa3b229a10831bd170010be1c5bfbede))
* add structure-only indexing for very large files and enhance filtering options ([f5d5104](https://github.com/gianged/cindex/commit/f5d5104f8ad084f1b9c581cb090cf7d60d0dc043))
* enhance chunk and file retrieval with configurable similarity thresholds and improve embedding context ([0e38522](https://github.com/gianged/cindex/commit/0e38522d88e8294c42d84e1f7890164d811bd2dc))
* enhance import tracking and progress notifications across multiple components ([7fc4812](https://github.com/gianged/cindex/commit/7fc481277108b49932b8e41f286680917d2acffc))
* enhance language support and configuration options ([1e174f0](https://github.com/gianged/cindex/commit/1e174f0efd920254429016dd1b5296af16092958))
* **errors:** add DatabaseNotConnectedError for improved error handling ([59b1d8a](https://github.com/gianged/cindex/commit/59b1d8aae15e9cbd0f946561bd1f876d0eafc6fd))
* **progress:** add legacy property names and required aliases for MCP tools ([59b1d8a](https://github.com/gianged/cindex/commit/59b1d8aae15e9cbd0f946561bd1f876d0eafc6fd))
* **tests:** add scale tests for small, stress, and very large codebases; implement secret file detector unit tests ([c1a6f2f](https://github.com/gianged/cindex/commit/c1a6f2f6feb06d002b965dcd41523d9d3ad3cf0b))


### Bug Fixes

* add 'type' field to MCP server configuration for stdio support ([48e973a](https://github.com/gianged/cindex/commit/48e973aca7995f44cf0ed6ab05d76f119f33ccc3))
* **ci:** use PAT for release-please PR creation ([9753bd0](https://github.com/gianged/cindex/commit/9753bd043de401087274afd5d1c6e8e8f1e82d16))
* update tree-sitter-c-sharp dependency version for consistency ([79c4b30](https://github.com/gianged/cindex/commit/79c4b30b4264ffb7289880bdd11661f8cbc91535))
* update Zod dependency version and improve schema adapter documentation for MCP SDK compatibility ([4f12e3a](https://github.com/gianged/cindex/commit/4f12e3aeed3b574151c37d192d482add3e3f0437))
