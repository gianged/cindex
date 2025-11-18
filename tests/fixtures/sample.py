"""
Sample Python file for testing
Contains functions, classes, imports
"""

import os
import sys
from typing import Optional, List, Dict
from datetime import datetime, timedelta
import numpy as np
from utils.database import Database
from models.user import User, UserRole

# Module-level constants
API_VERSION = "v1"
MAX_RETRIES = 3


class AuthService:
    """
    User authentication service
    Handles login, logout, and session management
    """

    def __init__(self, db_client: Database):
        """Initialize auth service with database client"""
        self.db_client = db_client
        self.session_timeout = 3600  # 1 hour in seconds

    async def login(self, email: str, password: str) -> Optional[User]:
        """
        Authenticate user with credentials

        Args:
            email: User email address
            password: User password

        Returns:
            User object if authentication succeeds, None otherwise
        """
        if not email or not password:
            raise ValueError("Email and password are required")

        user = await self.db_client.query(
            "SELECT * FROM users WHERE email = ?", (email,)
        )

        if not user:
            return None

        is_valid = await self._verify_password(password, user.password_hash)

        if not is_valid:
            return None

        return user

    async def _verify_password(self, password: str, hash: str) -> bool:
        """Verify password against hash"""
        # Simplified for testing
        return password == hash

    async def create_session(self, user_id: str) -> str:
        """Create new user session"""
        session_id = self._generate_session_id()
        expires_at = datetime.now() + timedelta(seconds=self.session_timeout)

        await self.db_client.query(
            "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
            (session_id, user_id, expires_at),
        )

        return session_id

    def _generate_session_id(self) -> str:
        """Generate random session ID"""
        import random
        import string

        return "".join(random.choices(string.ascii_letters + string.digits, k=32))


def has_permission(user: User, required_role: UserRole) -> bool:
    """
    Check user role and permissions

    Args:
        user: User object
        required_role: Required role for access

    Returns:
        True if user has required permission
    """
    role_hierarchy = {
        UserRole.ADMIN: 3,
        UserRole.MODERATOR: 2,
        UserRole.USER: 1,
    }

    return role_hierarchy.get(user.role, 0) >= role_hierarchy.get(required_role, 0)


def calculate_complexity(data: List[int]) -> Dict[str, float]:
    """
    Calculate statistical complexity metrics

    Demonstrates loop and conditional usage
    """
    if not data:
        return {"mean": 0.0, "std": 0.0, "max": 0.0}

    total = 0
    count = len(data)

    # Calculate mean
    for value in data:
        total += value

    mean = total / count

    # Calculate standard deviation
    variance_sum = 0
    for value in data:
        variance_sum += (value - mean) ** 2

    std = (variance_sum / count) ** 0.5

    # Find maximum
    max_value = data[0]
    for value in data:
        if value > max_value:
            max_value = value

    return {"mean": mean, "std": std, "max": float(max_value)}


# Exports
__all__ = ["AuthService", "has_permission", "calculate_complexity"]
