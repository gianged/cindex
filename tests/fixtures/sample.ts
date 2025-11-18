/**
 * Sample TypeScript file for testing
 * Contains functions, classes, imports, exports
 */

import { Request, Response } from 'express';
import * as path from 'node:path';
import { DatabaseClient } from './database';
import type { User, UserRole } from '@/types/user';

// Top-level constant
export const API_VERSION = 'v1';
export const MAX_RETRIES = 3;

/**
 * User authentication service
 * Handles login, logout, and session management
 */
export class AuthService {
  private dbClient: DatabaseClient;
  private sessionTimeout: number;

  constructor(dbClient: DatabaseClient) {
    this.dbClient = dbClient;
    this.sessionTimeout = 3600000; // 1 hour
  }

  /**
   * Authenticate user with credentials
   *
   * @param email - User email address
   * @param password - User password
   * @returns User object if authentication succeeds
   */
  async login(email: string, password: string): Promise<User | null> {
    if (!email || !password) {
      throw new Error('Email and password are required');
    }

    const user = await this.dbClient.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (!user) {
      return null;
    }

    const isValid = await this.verifyPassword(password, user.password_hash);

    if (!isValid) {
      return null;
    }

    return user;
  }

  /**
   * Verify password against hash
   */
  private async verifyPassword(password: string, hash: string): Promise<boolean> {
    // Simulate password verification logic
    return password === hash; // Simplified for testing
  }

  /**
   * Create new user session
   */
  async createSession(userId: string): Promise<string> {
    const sessionId = this.generateSessionId();

    await this.dbClient.query(
      'INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)',
      [sessionId, userId, new Date(Date.now() + this.sessionTimeout)]
    );

    return sessionId;
  }

  /**
   * Generate random session ID
   */
  private generateSessionId(): string {
    return Math.random().toString(36).substring(2, 15);
  }
}

/**
 * Express route handler for login
 */
export const loginHandler = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body;

  try {
    const authService = new AuthService(req.app.get('dbClient'));
    const user = await authService.login(email, password);

    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const sessionId = await authService.createSession(user.id);

    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 3600000,
    });

    res.json({ user });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Check user role and permissions
 */
export function hasPermission(user: User, requiredRole: UserRole): boolean {
  const roleHierarchy: Record<UserRole, number> = {
    admin: 3,
    moderator: 2,
    user: 1,
  };

  return roleHierarchy[user.role] >= roleHierarchy[requiredRole];
}

// Default export
export default AuthService;
