"""
Pomodoro Timer Router
---------------------
API endpoints for managing focus sessions. 
Allows users to start, stop, and track real-time progress of their learning sprints.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db
from db.models import PomodoroSession, User
from schemas.schemas import PomodoroOut, PomodoroStart, PomodoroProgress
from auth.dependencies import get_current_user
from agents.tools import log_pomodoro_complete

router = APIRouter(prefix="/timer", tags=["Pomodoro Timer"])


@router.post("/start", response_model=PomodoroOut)
async def start_timer(
    payload: PomodoroStart,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Initializes a new focus session for the authenticated user.
    Stores the topic and planned duration in the database.
    """
    session = PomodoroSession(
        user_id=current_user.id,
        focus_minutes=payload.focus_minutes,
        break_minutes=payload.break_minutes,
        topic=payload.topic,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.post("/stop/{session_id}", response_model=PomodoroOut)
async def stop_timer(
    session_id: int,
    completed: bool = True,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Ends an active focus session. 
    Updates the session record with completion status and timestamps.
    """
    await log_pomodoro_complete(db, session_id, completed=completed, interrupted=not completed)
    result = await db.execute(select(PomodoroSession).where(PomodoroSession.id == session_id))
    session = result.scalar_one_or_none()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
        
    return session


@router.post("/progress")
async def update_progress(
    payload: PomodoroProgress,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Live progress sync endpoint.
    Called periodically by the frontend timer to increment focus time 
    in the database while the session is running.
    """
    from agents.tools import update_live_focus_time
    return await update_live_focus_time(db, current_user.id, payload.delta_seconds)


@router.get("/history", response_model=list[PomodoroOut])
async def get_timer_history(
    limit: int = 20,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieves the most recent focus sessions for the authenticated user.
    Useful for populating historical charts or session logs.
    """
    result = await db.execute(
        select(PomodoroSession)
        .where(PomodoroSession.user_id == current_user.id)
        .order_by(PomodoroSession.started_at.desc())
        .limit(limit)
    )
    return result.scalars().all()
