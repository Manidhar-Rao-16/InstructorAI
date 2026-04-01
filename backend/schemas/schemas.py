"""
Pydantic schemas (request / response models).
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, field_validator, field_serializer


# ─── Auth ─────────────────────────────────────────────────────────────────────

class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    display_name: Optional[str] = None
    role: str = "user"  # "user" or "admin" (admin needs secret)

    @field_validator('email', mode='before')
    @classmethod
    def normalize_email(cls, v: str) -> str:
        if isinstance(v, str):
            return v.strip().lower()
        return v


class UserLogin(BaseModel):
    email: EmailStr
    password: str

    @field_validator('email', mode='before')
    @classmethod
    def normalize_email(cls, v: str) -> str:
        if isinstance(v, str):
            return v.strip().lower()
        return v
class GoogleLoginRequest(BaseModel):
    id_token: str
    role: str = "user"


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: int
    display_name: Optional[str] = None


class UserOut(BaseModel):
    id: int
    email: str
    role: str
    display_name: Optional[str] = None
    created_at: datetime

    @field_serializer('created_at')
    def serialize_dt(self, dt: datetime, _info):
        return dt.isoformat() + ('Z' if dt.tzinfo is None else '')

    class Config:
        from_attributes = True


# ─── Profile ──────────────────────────────────────────────────────────────────

class ProfileUpdate(BaseModel):
    display_name: Optional[str] = None
    current_language: Optional[str] = None
    proficiency_level: Optional[str] = None
    learning_goal: Optional[str] = None
    response_style: Optional[str] = None


class ProfileOut(BaseModel):
    user_id: int
    display_name: Optional[str]
    current_language: Optional[str]
    proficiency_level: Optional[str]
    learning_goal: Optional[str]
    response_style: str
    assessment_completed: bool
    total_focus_minutes: int
    streak_days: int

    class Config:
        from_attributes = True


# ─── Chat ─────────────────────────────────────────────────────────────────────

class ChatMessageIn(BaseModel):
    content: str
    session_id: Optional[int] = None
    chat_session_id: Optional[int] = None
    topic: Optional[str] = None
    module_title: Optional[str] = None
    module_content: Optional[str] = None


class ChatReplyOut(BaseModel):
    reply: str


class ChatSessionCreate(BaseModel):
    title: Optional[str] = "New Chat"


class ChatSessionOut(BaseModel):
    id: int
    title: str
    created_at: datetime
    updated_at: Optional[datetime] = None
    message_count: int = 0
    is_roadmap: bool = False
    learning_session_id: Optional[int] = None
    modules: Optional[list['StepOut']] = None

    class Config:
        from_attributes = True


class ChatMessageOut(BaseModel):
    id: int
    role: str
    content: str
    topic: Optional[str] = None
    agent_name: Optional[str]
    created_at: datetime

    @field_serializer('created_at')
    def serialize_dt(self, dt: datetime, _info):
        return dt.isoformat() + ('Z' if dt.tzinfo is None else '')

    class Config:
        from_attributes = True


# ─── Learning Session ─────────────────────────────────────────────────────────

class SessionOut(BaseModel):
    id: int
    topic: str
    language: Optional[str]
    status: str
    total_steps: int
    completed_steps: int
    roadmap: Optional[str] = None  # Added missing field
    started_at: datetime

    @field_serializer('started_at')
    def serialize_dt(self, dt: datetime, _info):
        return dt.isoformat() + ('Z' if dt.tzinfo is None else '')

    class Config:
        from_attributes = True


class RoadmapRequest(BaseModel):
    topic: str
    duration: str
    level: str
    start_date: Optional[str] = None


# ─── Assignment ───────────────────────────────────────────────────────────────

class AssignmentTextSubmit(BaseModel):
    assignment_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    content: str
    session_id: Optional[int] = None


class AssignmentOut(BaseModel):
    id: int
    session_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    submission_type: str
    score: Optional[float]
    feedback: Optional[str]
    improvements: Optional[str]
    status: str
    submitted_at: datetime
    topic_title: Optional[str] = None

    @field_serializer('submitted_at')
    def serialize_dt(self, dt: datetime, _info):
        return dt.isoformat() + ('Z' if dt.tzinfo is None else '')

    class Config:
        from_attributes = True


# ─── Pomodoro ─────────────────────────────────────────────────────────────────

class PomodoroStart(BaseModel):
    topic: Optional[str] = None
    focus_minutes: int = 25
    break_minutes: int = 5


class PomodoroProgress(BaseModel):
    session_id: int
    delta_seconds: int


class PomodoroOut(BaseModel):
    id: int
    focus_minutes: int
    break_minutes: int
    completed: bool
    interrupted: bool
    topic: Optional[str]
    started_at: datetime
    ended_at: Optional[datetime]

    @field_serializer('started_at', 'ended_at')
    def serialize_dt(self, dt: datetime, _info):
        if dt is None: return None
        return dt.isoformat() + ('Z' if dt.tzinfo is None else '')

    class Config:
        from_attributes = True


# ─── Progress ─────────────────────────────────────────────────────────────────

class ProgressLogOut(BaseModel):
    log_date: str
    topics_studied: int
    topics_completed: int
    assignments_submitted: int
    focus_minutes: int
    pomodoro_count: int
    avg_score: Optional[float]

    class Config:
        from_attributes = True


class DashboardOut(BaseModel):
    total_sessions: int
    completed_sessions_count: int
    completion_percentage: float
    total_assignments: int
    evaluated_assignments: int
    avg_score: Optional[float]
    total_focus_minutes: int
    streak_days: int
    recent_logs: list[ProgressLogOut]
    active_sessions: list[SessionOut]
    completed_sessions: list[SessionOut]


# ─── Notification ─────────────────────────────────────────────────────────────

class NotificationOut(BaseModel):
    id: int
    type: str
    title: str
    message: str
    is_read: bool
    action_url: Optional[str] = None
    sent_at: datetime

    @field_serializer('sent_at')
    def serialize_dt(self, dt: datetime, _info):
        return dt.isoformat() + ('Z' if dt.tzinfo is None else '')

    class Config:
        from_attributes = True


# ─── Admin ────────────────────────────────────────────────────────────────────

class AdminUserReport(BaseModel):
    user_id: int
    email: str
    display_name: Optional[str]
    total_sessions: int
    completed_sessions: int
    avg_score: Optional[float]
    total_focus_minutes: int
    streak_days: int
    last_activity: Optional[datetime]


# ─── Learning Steps ────────────────────────────────────────────────────────────

class StepOut(BaseModel):
    id: int
    step_number: int
    title: str
    content: Optional[str]
    is_complete: bool
    target_date: Optional[str] = None
    completed_at: Optional[datetime] = None
    total_tasks: int = 0
    completed_tasks: int = 0

    @field_serializer('completed_at')
    def serialize_dt(self, dt: datetime, _info):
        if dt is None: return None
        return dt.isoformat() + ('Z' if dt.tzinfo is None else '')

    class Config:
        from_attributes = True


class StepToggleOut(BaseModel):
    step_id: int
    is_complete: bool
    completed_steps: int
