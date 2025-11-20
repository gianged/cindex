/**
 * Unit tests for secret file detector
 */

import { describe, expect, it } from '@jest/globals';

import { createSecretFileDetector, DEFAULT_SECRET_PATTERNS } from '@indexing/secret-file-detector';

describe('SecretFileDetector', () => {
  describe('Environment Files', () => {
    it('should detect .env files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('.env')).toBe(true);
      expect(detector.isSecretFile('src/.env')).toBe(true);
      expect(detector.isSecretFile('config/.env')).toBe(true);
    });

    it('should detect .env.* variants', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('.env.local')).toBe(true);
      expect(detector.isSecretFile('.env.production')).toBe(true);
      expect(detector.isSecretFile('.env.staging')).toBe(true);
      expect(detector.isSecretFile('.env.development')).toBe(true);
      expect(detector.isSecretFile('.env.test')).toBe(true);
      expect(detector.isSecretFile('config/.env.production')).toBe(true);
    });

    it('should detect *.env files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('development.env')).toBe(true);
      expect(detector.isSecretFile('production.env')).toBe(true);
      expect(detector.isSecretFile('config/app.env')).toBe(true);
    });

    it('should allow .env.example files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('.env.example')).toBe(false);
      expect(detector.isSecretFile('.env.sample')).toBe(false);
      expect(detector.isSecretFile('.env.template')).toBe(false);
      expect(detector.isSecretFile('config/.env.example')).toBe(false);
    });
  });

  describe('Credential Files', () => {
    it('should detect credential files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('credentials.json')).toBe(true);
      expect(detector.isSecretFile('aws-credentials')).toBe(true);
      expect(detector.isSecretFile('service-account-credentials.json')).toBe(true);
      expect(detector.isSecretFile('config/db-credentials.yml')).toBe(true);
    });

    it('should detect secret files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('secrets.json')).toBe(true);
      expect(detector.isSecretFile('secrets.yml')).toBe(true);
      expect(detector.isSecretFile('secrets.yaml')).toBe(true);
      expect(detector.isSecretFile('app-secrets.json')).toBe(true);
    });

    it('should detect password files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('passwords.txt')).toBe(true);
      expect(detector.isSecretFile('database-password')).toBe(true);
      expect(detector.isSecretFile('admin-password.json')).toBe(true);
    });

    it('should detect auth files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('auth.json')).toBe(true);
      expect(detector.isSecretFile('firebase-auth.json')).toBe(true);
      expect(detector.isSecretFile('service-account-key.json')).toBe(true);
      expect(detector.isSecretFile('token.json')).toBe(true);
    });
  });

  describe('Keys and Certificates', () => {
    it('should detect private keys', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('private.key')).toBe(true);
      expect(detector.isSecretFile('server.key')).toBe(true);
      expect(detector.isSecretFile('ssl/private.key')).toBe(true);
      expect(detector.isSecretFile('app.pem')).toBe(true);
    });

    it('should detect SSH keys', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('id_rsa')).toBe(true);
      expect(detector.isSecretFile('id_rsa.pub')).toBe(true);
      expect(detector.isSecretFile('id_dsa')).toBe(true);
      expect(detector.isSecretFile('id_ecdsa')).toBe(true);
      expect(detector.isSecretFile('id_ed25519')).toBe(true);
    });

    it('should detect certificate files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('cert.pem')).toBe(true);
      expect(detector.isSecretFile('server.crt')).toBe(true);
      expect(detector.isSecretFile('certificate.cer')).toBe(true);
      expect(detector.isSecretFile('keystore.p12')).toBe(true);
      expect(detector.isSecretFile('keystore.pfx')).toBe(true);
    });

    it('should detect GPG keys', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('private.gpg')).toBe(true);
      expect(detector.isSecretFile('key.asc')).toBe(true);
      expect(detector.isSecretFile('secring.gpg')).toBe(true);
    });
  });

  describe('Config Files with Secrets', () => {
    it('should detect config files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('.npmrc')).toBe(true);
      expect(detector.isSecretFile('.pypirc')).toBe(true);
      expect(detector.isSecretFile('.dockercfg')).toBe(true);
      expect(detector.isSecretFile('.netrc')).toBe(true);
    });

    it('should detect *.secret files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('app.secret')).toBe(true);
      expect(detector.isSecretFile('database.secret')).toBe(true);
      expect(detector.isSecretFile('api.secret')).toBe(true);
    });
  });

  describe('Safe Files (Should NOT be detected)', () => {
    it('should allow README files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('README.md')).toBe(false);
      expect(detector.isSecretFile('README.secrets.md')).toBe(false);
    });

    it('should allow example files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('config.example.json')).toBe(false);
      expect(detector.isSecretFile('secrets.example.yml')).toBe(false);
      expect(detector.isSecretFile('credentials.sample')).toBe(false);
    });

    it('should allow template files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('secrets.template')).toBe(false);
      expect(detector.isSecretFile('config.tmpl')).toBe(false);
      expect(detector.isSecretFile('auth.dist')).toBe(false);
    });

    it('should allow normal source files', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('index.ts')).toBe(false);
      expect(detector.isSecretFile('app.js')).toBe(false);
      expect(detector.isSecretFile('config.py')).toBe(false);
      expect(detector.isSecretFile('package.json')).toBe(false);
    });
  });

  describe('Custom Patterns', () => {
    it('should support custom patterns', () => {
      const detector = createSecretFileDetector({
        enabled: true,
        customPatterns: ['*.custom-secret', 'my-private-*'],
        replaceDefaultPatterns: false,
      });

      expect(detector.isSecretFile('app.custom-secret')).toBe(true);
      expect(detector.isSecretFile('my-private-data.json')).toBe(true);
      expect(detector.isSecretFile('.env')).toBe(true); // Still detects default patterns
    });

    it('should support replacing default patterns', () => {
      const detector = createSecretFileDetector({
        enabled: true,
        customPatterns: ['*.my-secret'],
        replaceDefaultPatterns: true,
      });

      expect(detector.isSecretFile('app.my-secret')).toBe(true);
      expect(detector.isSecretFile('.env')).toBe(false); // Default patterns disabled
      expect(detector.isSecretFile('credentials.json')).toBe(false); // Default patterns disabled
    });
  });

  describe('Pattern Matching', () => {
    it('should get matched pattern', () => {
      const detector = createSecretFileDetector();

      expect(detector.getMatchedPattern('.env')).toBe('.env');
      expect(detector.getMatchedPattern('.env.local')).toBe('.env.*');
      expect(detector.getMatchedPattern('credentials.json')).toBe('*credentials*');
      expect(detector.getMatchedPattern('id_rsa')).toBe('id_rsa');
      expect(detector.getMatchedPattern('index.ts')).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should track detection statistics', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('.env')).toBe(true);
      expect(detector.isSecretFile('credentials.json')).toBe(true);
      expect(detector.isSecretFile('index.ts')).toBe(false);
      expect(detector.isSecretFile('.env.local')).toBe(true);

      const stats = detector.getStats();
      expect(stats.total_checked).toBe(4);
      expect(stats.secrets_detected).toBe(3);
      expect(stats.pattern_matches['.env']).toBe(1);
      expect(stats.pattern_matches['*credentials*']).toBe(1);
      expect(stats.pattern_matches['.env.*']).toBe(1);
    });

    it('should reset statistics', () => {
      const detector = createSecretFileDetector();

      detector.isSecretFile('.env');
      detector.isSecretFile('credentials.json');

      let stats = detector.getStats();
      expect(stats.total_checked).toBe(2);
      expect(stats.secrets_detected).toBe(2);

      detector.resetStats();

      stats = detector.getStats();
      expect(stats.total_checked).toBe(0);
      expect(stats.secrets_detected).toBe(0);
      expect(Object.keys(stats.pattern_matches).length).toBe(0);
    });
  });

  describe('Enabled/Disabled State', () => {
    it('should be enabled by default', () => {
      const detector = createSecretFileDetector();

      expect(detector.isSecretFile('.env')).toBe(true);
    });

    it('should support disabling detection', () => {
      const detector = createSecretFileDetector({
        enabled: false,
        customPatterns: [],
        replaceDefaultPatterns: false,
      });

      expect(detector.isSecretFile('.env')).toBe(false);
      expect(detector.isSecretFile('credentials.json')).toBe(false);
      expect(detector.getMatchedPattern('.env')).toBeNull();
    });
  });

  describe('Default Patterns', () => {
    it('should export default patterns', () => {
      expect(DEFAULT_SECRET_PATTERNS).toBeDefined();
      expect(Array.isArray(DEFAULT_SECRET_PATTERNS)).toBe(true);
      expect(DEFAULT_SECRET_PATTERNS.length).toBeGreaterThan(0);
      expect(DEFAULT_SECRET_PATTERNS).toContain('.env');
      expect(DEFAULT_SECRET_PATTERNS).toContain('*credentials*');
      expect(DEFAULT_SECRET_PATTERNS).toContain('*.key');
    });
  });
});
