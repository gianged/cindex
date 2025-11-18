/**
 * Sample Rust file for testing
 * Contains structs, functions, traits, and implementations
 */

use std::collections::HashMap;
use std::io::{self, Read, Write};

// Type alias
pub type UserId = u64;
pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// User struct with authentication details
#[derive(Debug, Clone)]
pub struct User {
    pub id: UserId,
    pub email: String,
    pub password_hash: String,
    pub role: UserRole,
}

/// User role enumeration
#[derive(Debug, Clone, PartialEq)]
pub enum UserRole {
    Admin,
    Moderator,
    User,
}

/// Authentication service trait
pub trait AuthService {
    fn login(&self, email: &str, password: &str) -> Result<User>;
    fn create_session(&self, user_id: UserId) -> Result<String>;
    fn verify_password(&self, password: &str, hash: &str) -> bool;
}

/// Default authentication service implementation
pub struct DefaultAuthService {
    users: HashMap<String, User>,
    session_timeout: u64,
}

impl DefaultAuthService {
    /// Create a new authentication service
    ///
    /// # Arguments
    /// * `session_timeout` - Session timeout in seconds
    ///
    /// # Returns
    /// A new `DefaultAuthService` instance
    pub fn new(session_timeout: u64) -> Self {
        DefaultAuthService {
            users: HashMap::new(),
            session_timeout,
        }
    }

    /// Generate a random session ID
    fn generate_session_id(&self) -> String {
        use rand::Rng;
        let mut rng = rand::thread_rng();

        (0..32)
            .map(|_| {
                let idx = rng.gen_range(0..62);
                match idx {
                    0..=9 => (b'0' + idx) as char,
                    10..=35 => (b'a' + idx - 10) as char,
                    _ => (b'A' + idx - 36) as char,
                }
            })
            .collect()
    }

    /// Add a user to the service
    pub fn add_user(&mut self, user: User) {
        self.users.insert(user.email.clone(), user);
    }
}

impl AuthService for DefaultAuthService {
    /// Authenticate user with email and password
    fn login(&self, email: &str, password: &str) -> Result<User> {
        if email.is_empty() || password.is_empty() {
            return Err("Email and password are required".into());
        }

        let user = self.users.get(email)
            .ok_or("User not found")?;

        if !self.verify_password(password, &user.password_hash) {
            return Err("Invalid password".into());
        }

        Ok(user.clone())
    }

    /// Create a new session for the user
    fn create_session(&self, user_id: UserId) -> Result<String> {
        let session_id = self.generate_session_id();

        // In a real implementation, store session in database
        println!("Created session {} for user {}", session_id, user_id);

        Ok(session_id)
    }

    /// Verify password against hash
    fn verify_password(&self, password: &str, hash: &str) -> bool {
        // Simplified for testing - in production use bcrypt or argon2
        password == hash
    }
}

/// Check if user has required permission
///
/// # Arguments
/// * `user` - The user to check
/// * `required_role` - The required role
///
/// # Returns
/// `true` if user has sufficient permissions
pub fn has_permission(user: &User, required_role: &UserRole) -> bool {
    let role_hierarchy = |role: &UserRole| -> u8 {
        match role {
            UserRole::Admin => 3,
            UserRole::Moderator => 2,
            UserRole::User => 1,
        }
    };

    role_hierarchy(&user.role) >= role_hierarchy(required_role)
}

/// Calculate cyclomatic complexity metrics for demonstration
///
/// # Arguments
/// * `data` - Input data array
///
/// # Returns
/// A tuple of (mean, max) values
pub fn calculate_complexity(data: &[i32]) -> (f64, i32) {
    if data.is_empty() {
        return (0.0, 0);
    }

    let mut total = 0i64;
    let mut max_value = data[0];

    // Calculate sum and max (demonstrates loops and conditionals)
    for &value in data.iter() {
        total += value as i64;

        if value > max_value {
            max_value = value;
        }
    }

    let mean = total as f64 / data.len() as f64;

    (mean, max_value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_has_permission() {
        let admin_user = User {
            id: 1,
            email: "admin@test.com".to_string(),
            password_hash: "hash".to_string(),
            role: UserRole::Admin,
        };

        assert!(has_permission(&admin_user, &UserRole::User));
        assert!(has_permission(&admin_user, &UserRole::Moderator));
        assert!(has_permission(&admin_user, &UserRole::Admin));
    }

    #[test]
    fn test_calculate_complexity() {
        let data = vec![1, 2, 3, 4, 5];
        let (mean, max) = calculate_complexity(&data);

        assert_eq!(mean, 3.0);
        assert_eq!(max, 5);
    }
}
