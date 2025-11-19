/**
 * API call detection
 *
 * Detects cross-service API calls in code (HTTP, gRPC, GraphQL)
 */

import { logger } from '@utils/logger';
import { type APICallDetector, type APICallPattern, type DetectedAPICall } from '@/types/api-parsing';

/**
 * Cross-service API call detector
 */
export class CrossServiceAPICallDetector implements APICallDetector {
  private patterns: APICallPattern[];

  constructor() {
    this.patterns = this.initializePatterns();
  }

  /**
   * Detect API calls in code
   */
  public detectCalls = (filePath: string, content: string, _language: string): DetectedAPICall[] => {
    const calls: DetectedAPICall[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;

      for (const pattern of this.patterns) {
        const matches = line.matchAll(new RegExp(pattern.pattern, 'g'));

        for (const match of matches) {
          const endpoint = pattern.extractEndpoint(match);
          if (!endpoint) continue;

          const method = pattern.extractMethod?.(match) ?? undefined;

          calls.push({
            source_file: filePath,
            source_line: i + 1,
            call_type: pattern.call_type,
            target_endpoint: endpoint,
            method,
            confidence: this.calculateConfidence(match, pattern),
            code_snippet: line.trim(),
          });
        }
      }
    }

    logger.debug('API calls detected', {
      file: filePath,
      call_count: calls.length,
    });

    return calls;
  };

  /**
   * Get supported languages
   */
  public getSupportedLanguages = (): string[] => {
    return ['typescript', 'javascript', 'python', 'go', 'java', 'rust'];
  };

  /**
   * Initialize detection patterns
   */
  private initializePatterns = (): APICallPattern[] => {
    return [
      // JavaScript/TypeScript - fetch
      {
        pattern: /fetch\(['"`]([^'"`]+)['"`]/,
        call_type: 'http',
        extractEndpoint: (match) => match[1] || null,
      },

      // JavaScript/TypeScript - axios
      {
        pattern: /axios\.(get|post|put|patch|delete|head|options)\(['"`]([^'"`]+)['"`]/i,
        call_type: 'http',
        extractEndpoint: (match) => match[2] || null,
        extractMethod: (match) => match[1].toUpperCase() || null,
      },
      {
        pattern: /axios\(\s*{[^}]*url:\s*['"`]([^'"`]+)['"`][^}]*method:\s*['"`]([^'"`]+)['"`]/i,
        call_type: 'http',
        extractEndpoint: (match) => match[1] || null,
        extractMethod: (match) => match[2].toUpperCase() || null,
      },

      // JavaScript/TypeScript - node-fetch, got, superagent
      {
        pattern: /(?:got|superagent|request)\(['"`]([^'"`]+)['"`]/,
        call_type: 'http',
        extractEndpoint: (match) => match[1] || null,
      },

      // JavaScript/TypeScript - http/https modules
      {
        pattern: /(?:http|https)\.(?:get|request)\(['"`]([^'"`]+)['"`]/,
        call_type: 'http',
        extractEndpoint: (match) => match[1] || null,
      },

      // Python - requests
      {
        pattern: /requests\.(get|post|put|patch|delete|head|options)\(['"`]([^'"`]+)['"`]/i,
        call_type: 'http',
        extractEndpoint: (match) => match[2] || null,
        extractMethod: (match) => match[1].toUpperCase() || null,
      },

      // Python - httpx
      {
        pattern: /httpx\.(get|post|put|patch|delete|head|options)\(['"`]([^'"`]+)['"`]/i,
        call_type: 'http',
        extractEndpoint: (match) => match[2] || null,
        extractMethod: (match) => match[1].toUpperCase() || null,
      },

      // Python - aiohttp
      {
        pattern: /session\.(get|post|put|patch|delete|head|options)\(['"`]([^'"`]+)['"`]/i,
        call_type: 'http',
        extractEndpoint: (match) => match[2] || null,
        extractMethod: (match) => match[1].toUpperCase() || null,
      },

      // Go - http.Get, http.Post
      {
        pattern: /http\.(Get|Post|Put|Patch|Delete|Head)\("([^"]+)"\)/,
        call_type: 'http',
        extractEndpoint: (match) => match[2] || null,
        extractMethod: (match) => match[1].toUpperCase() || null,
      },

      // Go - http.NewRequest
      {
        pattern: /http\.NewRequest\("([^"]+)",\s*"([^"]+)"/,
        call_type: 'http',
        extractEndpoint: (match) => match[2] || null,
        extractMethod: (match) => match[1].toUpperCase() || null,
      },

      // Java - HttpClient, RestTemplate
      {
        pattern: /(?:httpClient|restTemplate)\.(get|post|put|patch|delete)\(['"`]([^'"`]+)['"`]/i,
        call_type: 'http',
        extractEndpoint: (match) => match[2] || null,
        extractMethod: (match) => match[1].toUpperCase() || null,
      },

      // Rust - reqwest
      {
        pattern: /reqwest::(?:get|post|put|patch|delete)\("([^"]+)"\)/,
        call_type: 'http',
        extractEndpoint: (match) => match[1] || null,
      },

      // gRPC - Client instantiation (TypeScript/JavaScript)
      {
        pattern: /new\s+(\w+)Client\(['"`]([^'"`]+):(\d+)['"`]/,
        call_type: 'grpc',
        extractEndpoint: (match) => `${match[2]}:${match[3]}`,
      },

      // gRPC - Python
      {
        pattern: /(\w+)_pb2_grpc\.(\w+)Stub\(grpc\.insecure_channel\(['"`]([^'"`]+)['"`]\)\)/,
        call_type: 'grpc',
        extractEndpoint: (match) => match[3] || null,
      },

      // gRPC - Go
      {
        pattern: /grpc\.Dial\("([^"]+)"/,
        call_type: 'grpc',
        extractEndpoint: (match) => match[1] || null,
      },

      // GraphQL - Apollo Client (TypeScript/JavaScript)
      {
        pattern: /(?:query|mutation):\s*gql`\s*(?:query|mutation)\s+(\w+)/i,
        call_type: 'graphql',
        extractEndpoint: (match) => match[1] || null,
      },

      // GraphQL - urql, relay
      {
        pattern: /useQuery\(\s*gql`\s*(?:query|mutation)\s+(\w+)/i,
        call_type: 'graphql',
        extractEndpoint: (match) => match[1] || null,
      },

      // GraphQL - Python (gql, graphql-core)
      {
        pattern: /gql\(["'`](?:query|mutation)\s+(\w+)/i,
        call_type: 'graphql',
        extractEndpoint: (match) => match[1] || null,
      },
    ];
  };

  /**
   * Calculate confidence score for match
   */
  private calculateConfidence = (match: RegExpMatchArray, pattern: APICallPattern): number => {
    const endpoint = pattern.extractEndpoint(match);
    if (!endpoint) return 0.3;

    // Higher confidence for absolute URLs
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) {
      return 0.95;
    }

    // Higher confidence for URLs with host:port
    if (/^[\w.-]+:\d+/.test(endpoint)) {
      return 0.9;
    }

    // Medium confidence for absolute paths
    if (endpoint.startsWith('/')) {
      return 0.75;
    }

    // Lower confidence for relative paths or variables
    if (endpoint.includes('$') || endpoint.includes('{')) {
      return 0.5;
    }

    return 0.6;
  };

  /**
   * Resolve service from endpoint URL
   *
   * Attempts to resolve which service an endpoint belongs to
   */
  public resolveTargetService = (endpoint: string, serviceRegistry: Map<string, string[]>): string | undefined => {
    // serviceRegistry: Map<service_id, endpoints[]>

    // Extract path from full URL
    let targetPath = endpoint;
    if (endpoint.startsWith('http')) {
      try {
        const url = new URL(endpoint);
        targetPath = url.pathname;
      } catch {
        // Invalid URL, use as-is
      }
    }

    // Search for matching service
    for (const [serviceId, endpoints] of serviceRegistry.entries()) {
      for (const ep of endpoints) {
        // Simple prefix matching (can be improved with regex)
        if (targetPath.startsWith(ep) || ep.startsWith(targetPath)) {
          return serviceId;
        }
      }
    }

    return undefined;
  };

  /**
   * Batch detect API calls in multiple files
   */
  public detectBatch = (
    files: { path: string; content: string; language: string }[]
  ): Map<string, DetectedAPICall[]> => {
    const results = new Map<string, DetectedAPICall[]>();

    for (const file of files) {
      const calls = this.detectCalls(file.path, file.content, file.language);
      if (calls.length > 0) {
        results.set(file.path, calls);
      }
    }

    return results;
  };
}

/**
 * Create API call detector instance
 */
export const createAPICallDetector = (): CrossServiceAPICallDetector => {
  return new CrossServiceAPICallDetector();
};
