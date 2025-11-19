/**
 * Sample C++ file for testing parser
 * Contains classes, functions, namespaces, and templates
 */

#include <iostream>
#include <string>
#include <vector>
#include "database.h"

using namespace std;

// Constants
const int SESSION_TIMEOUT = 3600;
const string API_VERSION = "v1";

// User role enumeration
enum UserRole {
    ROLE_ADMIN,
    ROLE_MODERATOR,
    ROLE_USER
};

// User struct
struct User {
    string id;
    string email;
    string passwordHash;
    UserRole role;
};

// Forward declaration
class Database;

/**
 * Authentication service class
 * Handles user login and session management
 */
class AuthService {
private:
    Database* dbClient;
    int sessionTimeout;

    /**
     * Verify password against hash
     */
    bool verifyPassword(const string& password, const string& hash) {
        // Simplified for testing
        return password == hash;
    }

    /**
     * Generate random session ID
     */
    string generateSessionId() {
        return "session_" + to_string(time(nullptr));
    }

public:
    /**
     * Constructor
     */
    AuthService(Database* db) : dbClient(db), sessionTimeout(SESSION_TIMEOUT) {}

    /**
     * Destructor
     */
    ~AuthService() {}

    /**
     * Authenticate user with credentials
     *
     * @param email User email address
     * @param password User password
     * @return Pointer to User object if authentication succeeds, nullptr otherwise
     */
    User* login(const string& email, const string& password) {
        if (email.empty() || password.empty()) {
            throw invalid_argument("Email and password are required");
        }

        User* user = dbClient->query("SELECT * FROM users WHERE email = ?", email);

        if (user == nullptr) {
            return nullptr;
        }

        bool isValid = verifyPassword(password, user->passwordHash);

        if (!isValid) {
            return nullptr;
        }

        return user;
    }

    /**
     * Create new user session
     */
    string createSession(const string& userId) {
        string sessionId = generateSessionId();

        dbClient->execute(
            "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
            sessionId, userId, time(nullptr) + sessionTimeout
        );

        return sessionId;
    }
};

/**
 * Permission utility namespace
 */
namespace PermissionUtils {
    /**
     * Check if user has required permission level
     */
    bool hasPermission(const User& user, UserRole requiredRole) {
        return user.role >= requiredRole;
    }

    /**
     * Get role level as integer
     */
    int getRoleLevel(UserRole role) {
        switch (role) {
            case ROLE_ADMIN:
                return 3;
            case ROLE_MODERATOR:
                return 2;
            case ROLE_USER:
                return 1;
            default:
                return 0;
        }
    }
}

/**
 * Template function for calculating complexity
 */
template<typename T>
T calculateMax(const vector<T>& data) {
    if (data.empty()) {
        throw invalid_argument("Data cannot be empty");
    }

    T maxValue = data[0];
    for (const auto& value : data) {
        if (value > maxValue) {
            maxValue = value;
        }
    }

    return maxValue;
}

/**
 * Main function
 */
int main() {
    cout << "Authentication Service v" << API_VERSION << endl;
    return 0;
}
