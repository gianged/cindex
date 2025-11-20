/**
 * Secret file detector - Pattern-based detection of sensitive files
 *
 * Provides a security layer to prevent indexing of secret files like .env,
 * credentials, keys, and certificates, even if they're not in .gitignore.
 */

import { logger } from '@utils/logger';

/**
 * Default patterns for secret file detection
 * Uses glob-style patterns with micromatch semantics
 */
export const DEFAULT_SECRET_PATTERNS = [
  // Environment files (highest priority)
  '.env',
  '.env.*',
  '*.env',
  '.env.local',
  '.env.production',
  '.env.staging',
  '.env.development',
  '.env.test',

  // Credentials & authentication
  '*credentials*',
  '*secrets*',
  '*password*',
  '*auth.json',
  'service-account*.json',
  '.npmrc',
  '.pypirc',
  '.dockercfg',
  'auth.json',
  'token.json',
  '.netrc',

  // Keys & certificates
  '*.key',
  '*.pem',
  '*.p12',
  '*.pfx',
  '*.cer',
  '*.crt',
  'id_rsa',
  'id_rsa.*',
  'id_dsa',
  'id_dsa.*',
  'id_ecdsa',
  'id_ecdsa.*',
  'id_ed25519',
  'id_ed25519.*',
  '*.gpg',
  '*.asc',

  // Cloud provider credentials
  '.aws/credentials',
  '.aws/config',
  'gcloud-key*.json',
  'azure-credentials*',

  // Database dumps & backups
  '*.dump',
  '*.bak',
  '*.backup',

  // Configuration with secrets
  '*.secret',
  'secrets.yml',
  'secrets.yaml',
  'secrets.json',
];

/**
 * Patterns that should NOT be considered secrets (allowlist)
 * These override the secret patterns above
 */
export const ALLOWED_PATTERNS = [
  '*.example',
  '*.example.*',
  '*.sample',
  '*.sample.*',
  '*.template',
  '*.template.*',
  '*.tmpl',
  '*.tmpl.*',
  '*.dist',
  '*.dist.*',
  'README*',
  'EXAMPLE*',
];

/**
 * Secret file detector configuration
 */
export interface SecretFileDetectorConfig {
  /**
   * Enable secret file protection
   * @default true
   */
  enabled: boolean;

  /**
   * Custom patterns to add to default patterns
   * Uses glob-style syntax
   * @default []
   */
  customPatterns: string[];

  /**
   * Replace default patterns instead of extending them
   * @default false
   */
  replaceDefaultPatterns: boolean;
}

/**
 * Secret file detection statistics
 */
export interface SecretFileStats {
  /**
   * Total files checked
   */
  total_checked: number;

  /**
   * Files detected as secrets
   */
  secrets_detected: number;

  /**
   * Pattern match counts
   */
  pattern_matches: Record<string, number>;
}

/**
 * Secret file detector class
 * Detects sensitive files that should not be indexed
 */
export class SecretFileDetector {
  private readonly patterns: string[];
  private readonly allowPatterns: string[];
  private readonly stats: SecretFileStats;
  private readonly enabled: boolean;

  /**
   * Create a new secret file detector
   *
   * @param config - Detector configuration
   */
  constructor(config: SecretFileDetectorConfig = { enabled: true, customPatterns: [], replaceDefaultPatterns: false }) {
    this.enabled = config.enabled;

    // Build pattern list
    if (config.replaceDefaultPatterns) {
      this.patterns = config.customPatterns;
    } else {
      this.patterns = [...DEFAULT_SECRET_PATTERNS, ...config.customPatterns];
    }

    this.allowPatterns = ALLOWED_PATTERNS;

    // Initialize statistics
    this.stats = {
      total_checked: 0,
      secrets_detected: 0,
      pattern_matches: {},
    };

    logger.debug('SecretFileDetector initialized', {
      enabled: this.enabled,
      patterns: this.patterns.length,
      allowPatterns: this.allowPatterns.length,
    });
  }

  /**
   * Check if a file path matches secret patterns
   *
   * @param filePath - Relative or absolute file path
   * @returns true if file is a secret file
   */
  isSecretFile(filePath: string): boolean {
    if (!this.enabled) {
      return false;
    }

    this.stats.total_checked++;

    // Normalize path to use forward slashes
    const normalizedPath = filePath.replace(/\\/g, '/');
    const basename = normalizedPath.split('/').pop() ?? '';
    const lowerPath = normalizedPath.toLowerCase();
    const lowerBasename = basename.toLowerCase();

    // Check allowlist first (highest priority)
    for (const pattern of this.allowPatterns) {
      if (this.matchesPattern(lowerBasename, pattern.toLowerCase())) {
        return false;
      }
    }

    // Check secret patterns
    for (const pattern of this.patterns) {
      const lowerPattern = pattern.toLowerCase();

      // Match against basename (most common case)
      if (this.matchesPattern(lowerBasename, lowerPattern)) {
        this.recordMatch(pattern);
        return true;
      }

      // Match against full path (for path-specific patterns like .aws/credentials)
      if (pattern.includes('/') && this.matchesPattern(lowerPath, lowerPattern)) {
        this.recordMatch(pattern);
        return true;
      }
    }

    return false;
  }

  /**
   * Get the pattern that matched a secret file
   *
   * @param filePath - File path to check
   * @returns Matched pattern or null if no match
   */
  getMatchedPattern(filePath: string): string | null {
    if (!this.enabled) {
      return null;
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const basename = normalizedPath.split('/').pop() ?? '';
    const lowerPath = normalizedPath.toLowerCase();
    const lowerBasename = basename.toLowerCase();

    // Check allowlist first
    for (const pattern of this.allowPatterns) {
      if (this.matchesPattern(lowerBasename, pattern.toLowerCase())) {
        return null;
      }
    }

    // Find matching secret pattern
    for (const pattern of this.patterns) {
      const lowerPattern = pattern.toLowerCase();

      if (this.matchesPattern(lowerBasename, lowerPattern)) {
        return pattern;
      }

      if (pattern.includes('/') && this.matchesPattern(lowerPath, lowerPattern)) {
        return pattern;
      }
    }

    return null;
  }

  /**
   * Get detection statistics
   *
   * @returns Detection statistics
   */
  getStats(): SecretFileStats {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  resetStats(): void {
    this.stats.total_checked = 0;
    this.stats.secrets_detected = 0;
    this.stats.pattern_matches = {};
  }

  /**
   * Simple glob pattern matching
   * Supports: *, ?, exact matches
   *
   * @param text - Text to match
   * @param pattern - Glob pattern
   * @returns true if pattern matches text
   */
  private matchesPattern(text: string, pattern: string): boolean {
    // Exact match
    if (text === pattern) {
      return true;
    }

    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // Escape special regex chars
      .replace(/\*/g, '.*') // * matches any characters
      .replace(/\?/g, '.'); // ? matches single character

    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(text);
  }

  /**
   * Record a pattern match in statistics
   *
   * @param pattern - Matched pattern
   */
  private recordMatch(pattern: string): void {
    this.stats.secrets_detected++;

    if (!this.stats.pattern_matches[pattern]) {
      this.stats.pattern_matches[pattern] = 0;
    }
    this.stats.pattern_matches[pattern]++;
  }
}

/**
 * Create a secret file detector with configuration
 *
 * @param config - Detector configuration
 * @returns Configured detector instance
 */
export const createSecretFileDetector = (config?: SecretFileDetectorConfig): SecretFileDetector => {
  return new SecretFileDetector(config);
};
