/**
 * Sample Java file for testing parser
 * Contains classes, methods, interfaces, imports
 */

package com.example.auth;

import java.util.List;
import java.util.ArrayList;
import java.util.Optional;
import static java.lang.Math.PI;
import com.example.models.User;
import com.example.database.Database;

/**
 * User authentication service
 * Handles login, logout, and session management
 */
public class AuthService {
    private Database dbClient;
    private static final int SESSION_TIMEOUT = 3600; // 1 hour in seconds
    private static final String API_VERSION = "v1";

    /**
     * Initialize auth service with database client
     */
    public AuthService(Database dbClient) {
        this.dbClient = dbClient;
    }

    /**
     * Authenticate user with credentials
     *
     * @param email User email address
     * @param password User password
     * @return User object if authentication succeeds, empty otherwise
     */
    public Optional<User> login(String email, String password) {
        if (email == null || email.isEmpty() || password == null || password.isEmpty()) {
            throw new IllegalArgumentException("Email and password are required");
        }

        User user = dbClient.query("SELECT * FROM users WHERE email = ?", email);

        if (user == null) {
            return Optional.empty();
        }

        boolean isValid = verifyPassword(password, user.getPasswordHash());

        if (!isValid) {
            return Optional.empty();
        }

        return Optional.of(user);
    }

    /**
     * Verify password against hash
     */
    private boolean verifyPassword(String password, String hash) {
        // Simplified for testing
        return password.equals(hash);
    }

    /**
     * Create new user session
     */
    public String createSession(String userId) {
        String sessionId = generateSessionId();
        long expiresAt = System.currentTimeMillis() + (SESSION_TIMEOUT * 1000L);

        dbClient.query(
            "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
            sessionId, userId, expiresAt
        );

        return sessionId;
    }

    /**
     * Generate random session ID
     */
    private String generateSessionId() {
        return java.util.UUID.randomUUID().toString();
    }
}

/**
 * User role enumeration
 */
enum UserRole {
    ADMIN,
    MODERATOR,
    USER
}

/**
 * Permission checker interface
 */
interface PermissionChecker {
    boolean hasPermission(User user, UserRole requiredRole);
}

/**
 * Utility class for permission checks
 */
public class PermissionUtils {
    /**
     * Check user role and permissions
     *
     * @param user User object
     * @param requiredRole Required role for access
     * @return true if user has required permission
     */
    public static boolean hasPermission(User user, UserRole requiredRole) {
        int userLevel = getRoleLevel(user.getRole());
        int requiredLevel = getRoleLevel(requiredRole);

        return userLevel >= requiredLevel;
    }

    /**
     * Get numeric level for role
     */
    private static int getRoleLevel(UserRole role) {
        switch (role) {
            case ADMIN:
                return 3;
            case MODERATOR:
                return 2;
            case USER:
                return 1;
            default:
                return 0;
        }
    }
}
