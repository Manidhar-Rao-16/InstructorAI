"""
SQLAlchemy ORM models for the InstructorAI platform.
Defines the database schema, including users, learning sessions, assignments, 
pomodoro focus sessions, and progress tracking logs.
"""
from __future__ import annotations

import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


# ─── Enums ──────────────────────────────────────────────────────────────────

class RoleEnum(str, enum.Enum):
    """User authorization roles."""
    user = "user"
    admin = "admin"


class ProficiencyEnum(str, enum.Enum):
    """Learning proficiency levels for roadmap tailoring."""
    level_1 = "Level 1 – Foundation"
    level_2 = "Level 2 – Beginner"
    level_3 = "Level 3 – Basic Practitioner"
    level_4 = "Level 4 – Intermediate"
    level_5 = "Level 5 – Skilled"
    level_6 = "Level 6 – Advanced"
    level_7 = "Level 7 – Professional"
    level_8 = "Level 8 – Specialist"
    level_9 = "Level 9 – Expert"
    level_10 = "Level 10 – Architect / Master"


class ResponseStyleEnum(str, enum.Enum):
    """Chatbot output persona styles."""
    socratic = "Socratic (Guide with questions)"
    practical = "Practical (Focus on code and tasks)"
    direct = "Direct (Straightforward and concise)"
    academic = "Academic (Deep theory and concepts)"


class SubmissionTypeEnum(str, enum.Enum):
    """Types of assignment submissions supported."""
    file = "file"
    text = "text"


class NotificationTypeEnum(str, enum.Enum):
    """Categories for user notifications."""
    morning_plan = "morning_plan"
    eod_reminder = "eod_reminder"
    missed_topic = "missed_topic"
    tomorrow_reminder = "tomorrow_reminder"
    general = "general"


# ─── User & Profile ──────────────────────────────────────────────────────────

class User(Base):
    """
    Main user account information. 
    Handles authentication and links to all user-generated content.
    """
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    google_id: Mapped[str | None] = mapped_column(String(100), unique=True, nullable=True, index=True)
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    role: Mapped[RoleEnum] = mapped_column(Enum(RoleEnum), default=RoleEnum.user, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    verification_token: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    # Relationships
    profile: Mapped["UserProfile"] = relationship("UserProfile", back_populates="user", uselist=False, cascade="all, delete-orphan")
    sessions: Mapped[list["LearningSession"]] = relationship("LearningSession", back_populates="user", cascade="all, delete-orphan")
    assignments: Mapped[list["Assignment"]] = relationship("Assignment", back_populates="user", cascade="all, delete-orphan")
    pomodoro_sessions: Mapped[list["PomodoroSession"]] = relationship("PomodoroSession", back_populates="user", cascade="all, delete-orphan")
    progress_logs: Mapped[list["ProgressLog"]] = relationship("ProgressLog", back_populates="user", cascade="all, delete-orphan")
    notifications: Mapped[list["Notification"]] = relationship("Notification", back_populates="user", cascade="all, delete-orphan")
    chat_messages: Mapped[list["ChatMessage"]] = relationship("ChatMessage", back_populates="user", cascade="all, delete-orphan")
    chat_sessions: Mapped[list["ChatSession"]] = relationship("ChatSession", back_populates="user", cascade="all, delete-orphan")


class UserProfile(Base):
    """
    Extended user information containing preferences and aggregate stats.
    Includes learning progress, proficiency, and focus minutes.
    """
    __tablename__ = "user_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(100))
    current_language: Mapped[str | None] = mapped_column(String(50))
    proficiency_level: Mapped[str | None] = mapped_column(String(100)) 
    response_style: Mapped[ResponseStyleEnum] = mapped_column(Enum(ResponseStyleEnum), default=ResponseStyleEnum.practical, nullable=False)
    learning_goal: Mapped[str | None] = mapped_column(Text)
    assessment_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    total_focus_minutes: Mapped[int] = mapped_column(Integer, default=0)
    streak_days: Mapped[int] = mapped_column(Integer, default=0)
    last_activity_date: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship("User", back_populates="profile")


# ─── Learning Session & Steps ────────────────────────────────────────────────

class LearningSession(Base):
    """
    Represents a learning module or topic a user is studying.
    Contains the generated roadmap and overall completion status.
    """
    __tablename__ = "learning_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    topic: Mapped[str] = mapped_column(String(200), nullable=False)
    language: Mapped[str | None] = mapped_column(String(50))
    roadmap: Mapped[str | None] = mapped_column(Text)  # JSON-serialized roadmap data
    status: Mapped[str] = mapped_column(String(50), default="in_progress")  # in_progress | completed | paused
    total_steps: Mapped[int] = mapped_column(Integer, default=0)
    completed_steps: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    complexity_rating: Mapped[int | None] = mapped_column(Integer)
    complexity_message: Mapped[str | None] = mapped_column(Text)

    user: Mapped["User"] = relationship("User", back_populates="sessions")
    steps: Mapped[list["LearningStep"]] = relationship("LearningStep", back_populates="session", cascade="all, delete-orphan")
    assignments: Mapped[list["Assignment"]] = relationship("Assignment", back_populates="session", cascade="all, delete-orphan")


class LearningStep(Base):
    """
    A specific milestone within a LearningSession.
    """
    __tablename__ = "learning_steps"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    session_id: Mapped[int] = mapped_column(Integer, ForeignKey("learning_sessions.id"), nullable=False)
    chat_session_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("chat_sessions.id"), nullable=True)
    step_number: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    is_complete: Mapped[bool] = mapped_column(Boolean, default=False)
    target_date: Mapped[str | None] = mapped_column(String(50))
    scheduled_time: Mapped[str | None] = mapped_column(String(50))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    session: Mapped["LearningSession"] = relationship("LearningSession", back_populates="steps")
    chat_session: Mapped["ChatSession | None"] = relationship("ChatSession")


# ─── Assignment ───────────────────────────────────────────────────────────────

class Assignment(Base):
    """
    Evaluations or tasks linked to a learning session.
    Stores submissions, AI-generated scores, and feedback.
    """
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    session_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("learning_sessions.id"))
    title: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    submission_type: Mapped[SubmissionTypeEnum] = mapped_column(Enum(SubmissionTypeEnum), nullable=False)
    submission_content: Mapped[str | None] = mapped_column(Text) # For text submissions
    file_path: Mapped[str | None] = mapped_column(String(500))    # For file uploads
    file_name: Mapped[str | None] = mapped_column(String(255))
    score: Mapped[float | None] = mapped_column(Float)
    feedback: Mapped[str | None] = mapped_column(Text)
    improvements: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="submitted")  # submitted | evaluated | pending
    submitted_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    evaluated_at: Mapped[datetime | None] = mapped_column(DateTime)

    user: Mapped["User"] = relationship("User", back_populates="assignments")
    session: Mapped["LearningSession | None"] = relationship("LearningSession", back_populates="assignments")


# ─── Pomodoro ────────────────────────────────────────────────────────────────

class PomodoroSession(Base):
    """
    Records of timed focus sessions.
    Used for analytics and productivity tracking.
    """
    __tablename__ = "pomodoro_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    focus_minutes: Mapped[int] = mapped_column(Integer, default=25)
    break_minutes: Mapped[int] = mapped_column(Integer, default=5)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    interrupted: Mapped[bool] = mapped_column(Boolean, default=False)
    topic: Mapped[str | None] = mapped_column(String(200))
    started_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime)

    user: Mapped["User"] = relationship("User", back_populates="pomodoro_sessions")


# ─── Progress Log ─────────────────────────────────────────────────────────────

class ProgressLog(Base):
    """
    Daily snapshots of user activity. 
    Aggregates focus time, topics studied, and scores for dashboard visualization.
    """
    __tablename__ = "progress_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    log_date: Mapped[str] = mapped_column(String(10), nullable=False)  # Format: YYYY-MM-DD
    topics_studied: Mapped[int] = mapped_column(Integer, default=0)
    topics_completed: Mapped[int] = mapped_column(Integer, default=0)
    assignments_submitted: Mapped[int] = mapped_column(Integer, default=0)
    assignments_completed: Mapped[int] = mapped_column(Integer, default=0)
    focus_minutes: Mapped[int] = mapped_column(Integer, default=0)
    pomodoro_count: Mapped[int] = mapped_column(Integer, default=0)
    avg_score: Mapped[float | None] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship("User", back_populates="progress_logs")


# ─── Notification ─────────────────────────────────────────────────────────────

class Notification(Base):
    """
    System and educational notifications for the user.
    """
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    type: Mapped[NotificationTypeEnum] = mapped_column(Enum(NotificationTypeEnum), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime)
    action_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship("User", back_populates="notifications")


# ─── Chat Session ───────────────────────────────────────────────────────

class ChatSession(Base):
    """
    Groups chat messages into logical conversations.
    """
    __tablename__ = "chat_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(200), default="New Chat")  # auto-set from first message
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    user: Mapped["User"] = relationship("User", back_populates="chat_sessions")
    messages: Mapped[list["ChatMessage"]] = relationship("ChatMessage", back_populates="chat_session", cascade="all, delete-orphan")


# ─── Chat History ─────────────────────────────────────────────────────────────

class ChatMessage(Base):
    """
    Individual messages within a chat.
    Stores the speaker (role), content, and link to learning sessions if relevant.
    """
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), nullable=False)
    session_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("learning_sessions.id"))
    chat_session_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("chat_sessions.id"), index=True)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # user | assistant | system
    content: Mapped[str] = mapped_column(Text, nullable=False)
    topic: Mapped[str | None] = mapped_column(String(255), index=True)
    agent_name: Mapped[str | None] = mapped_column(String(100)) # e.g. "TeachingAgent"
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship("User", back_populates="chat_messages")
    chat_session: Mapped["ChatSession | None"] = relationship("ChatSession", back_populates="messages")
