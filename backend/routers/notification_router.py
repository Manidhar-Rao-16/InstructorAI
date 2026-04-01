"""
Notifications router.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from db.database import get_db
from db.models import Notification, User
from schemas.schemas import NotificationOut
from auth.dependencies import get_current_user

router = APIRouter(prefix="/notifications", tags=["Notifications"])


@router.get("/", response_model=list[NotificationOut])
async def get_notifications(
    unread_only: bool = False,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(Notification).where(Notification.user_id == current_user.id)
    if unread_only:
        query = query.where(Notification.is_read == False)
    query = query.order_by(Notification.sent_at.desc()).limit(50)
    result = await db.execute(query)
    return result.scalars().all()


@router.patch("/{notif_id}/read")
async def mark_read(
    notif_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification).where(
            Notification.id == notif_id,
            Notification.user_id == current_user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if notif:
        notif.is_read = True
        await db.commit()
    return {"status": "ok"}


@router.patch("/mark-all-read")
async def mark_all_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
            Notification.is_read == False,
        )
    )
    for n in result.scalars().all():
        n.is_read = True
    await db.commit()
    return {"status": "ok"}

@router.post("/test")
async def send_test_notification(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from agents.tools import send_notification
    await send_notification(
        db, current_user.id,
        notif_type="general",
        title="Notification System Test",
        message="Your notification system is up and running! 🎉 This is a real-time test notification.",
    )
    return {"status": "success", "message": "Test notification sent."}


@router.post("/end-of-day")
async def end_of_day_notification(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger an end-of-day summary notification."""
    from agents.tools import send_notification
    from db.models import Assignment, LearningSession, LearningStep
    from datetime import date
    today = date.today().isoformat()
    pending_res = await db.execute(
        select(Notification).where(
            Notification.user_id == current_user.id,
        )
    )
    pending_tasks_res = await db.execute(
        select(Assignment).where(Assignment.user_id == current_user.id, Assignment.status == "pending")
    )
    pending_tasks = pending_tasks_res.scalars().all()
    # Steps due today
    due_res = await db.execute(
        select(LearningStep)
        .join(LearningSession)
        .where(LearningSession.user_id == current_user.id, LearningStep.target_date == today, LearningStep.is_complete == False)
    )
    due_steps = due_res.scalars().all()
    due_names = ", ".join(s.title for s in due_steps[:2]) if due_steps else "None"
    msg = f"End of day! You have {len(pending_tasks)} pending task(s). Chapters due today not yet complete: {due_names}. Great work today — rest up and come back strong! 🌙"
    await send_notification(db, current_user.id, notif_type="eod_reminder", title="End of Day Summary 🌙", message=msg)
    return {"status": "ok"}
