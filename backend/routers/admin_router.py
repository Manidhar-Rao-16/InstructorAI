"""
Admin monitoring router — admin-only endpoints.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from db.database import get_db
from db.models import Assignment, LearningSession, User, UserProfile
from schemas.schemas import AdminUserReport
from auth.dependencies import require_admin

router = APIRouter(prefix="/admin", tags=["Admin"])


@router.get("/users", response_model=list[AdminUserReport])
async def list_users(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.role == "user"))
    users = result.scalars().all()

    reports = []
    for user in users:
        prof = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
        profile = prof.scalar_one_or_none()

        total_sess = await db.execute(select(func.count()).where(LearningSession.user_id == user.id))
        comp_sess = await db.execute(
            select(func.count()).where(LearningSession.user_id == user.id, LearningSession.status == "completed")
        )
        avg_score = await db.execute(
            select(func.avg(Assignment.score)).where(
                Assignment.user_id == user.id, Assignment.score.isnot(None)
            )
        )

        reports.append(
            AdminUserReport(
                user_id=user.id,
                email=user.email,
                display_name=profile.display_name if profile else None,
                total_sessions=total_sess.scalar() or 0,
                completed_sessions=comp_sess.scalar() or 0,
                avg_score=round(avg_score.scalar(), 1) if avg_score.scalar() else None,
                total_focus_minutes=profile.total_focus_minutes if profile else 0,
                streak_days=profile.streak_days if profile else 0,
                last_activity=profile.last_activity_date if profile else None,
            )
        )
    return reports


@router.get("/stats")
async def platform_stats(
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    total_users = await db.execute(select(func.count()).where(User.role == "user"))
    total_sessions = await db.execute(select(func.count(LearningSession.id)))
    completed_sessions = await db.execute(
        select(func.count()).where(LearningSession.status == "completed")
    )
    total_assignments = await db.execute(select(func.count(Assignment.id)))
    avg_platform_score = await db.execute(
        select(func.avg(Assignment.score)).where(Assignment.score.isnot(None))
    )

    return {
        "total_users": total_users.scalar() or 0,
        "total_sessions": total_sessions.scalar() or 0,
        "completed_sessions": completed_sessions.scalar() or 0,
        "total_assignments": total_assignments.scalar() or 0,
        "avg_platform_score": round(avg_platform_score.scalar(), 1) if avg_platform_score.scalar() else None,
    }
