"""
APScheduler — automated morning plan, EOD reminder, and weekly report jobs.
"""
from __future__ import annotations

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select, delete

from config import settings
from db.database import AsyncSessionLocal
from db.models import LearningSession, LearningStep, Notification, NotificationTypeEnum, ProgressLog, User
from agents.tools import send_notification
from utils.date_helpers import shift_dates_forward

import logging
logger = logging.getLogger("instructor_ai")

scheduler = AsyncIOScheduler()


async def _get_all_active_users() -> list[int]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User.id).where(User.is_active == True, User.role == "user"))
        return result.scalars().all()


async def morning_plan_job():
    """Send a morning summary notification to all active users."""
    user_ids = await _get_all_active_users()
    async with AsyncSessionLocal() as db:
        for uid in user_ids:
            # Get current in-progress sessions
            sess_result = await db.execute(
                select(LearningSession)
                .where(LearningSession.user_id == uid, LearningSession.status == "in_progress")
                .limit(3)
            )
            sessions = sess_result.scalars().all()
            if sessions:
                topics = ", ".join(s.topic for s in sessions)
                msg = f"Good morning! 🌅 Today's learning topics: {topics}. Keep up the momentum!"
            else:
                msg = "Good morning! 🌅 Ready to start your learning journey? Pick a topic to begin!"

            await send_notification(
                db, uid,
                notif_type=NotificationTypeEnum.morning_plan.value,
                title="Good Morning — Today's Plan",
                message=msg,
            )


async def eod_reminder_job():
    """End-of-day: check missed goals and send recap notification."""
    from datetime import date
    today = date.today().isoformat()
    user_ids = await _get_all_active_users()
    async with AsyncSessionLocal() as db:
        for uid in user_ids:
            log_result = await db.execute(
                select(ProgressLog).where(ProgressLog.user_id == uid, ProgressLog.log_date == today)
            )
            log = log_result.scalar_one_or_none()

            if log and log.topics_completed > 0:
                msg = (
                    f"Great work today! 🎉 You completed {log.topics_completed} topic(s) "
                    f"and spent {log.focus_minutes} minutes focused. Keep it up!"
                )
            else:
                msg = (
                    "You missed today's learning goal. 😔 No worries — "
                    "your tasks have been rescheduled for tomorrow. See you then!"
                )
                # Actual DB Rescheduling:
                # Find uncompleted steps scheduled for today or earlier
                missed_steps_result = await db.execute(
                    select(LearningStep)
                    .join(LearningSession)
                    .where(
                        LearningSession.user_id == uid,
                        LearningStep.is_complete == False,
                        LearningStep.target_date <= today
                    )
                )
                missed_steps = missed_steps_result.scalars().all()
                if missed_steps:
                    # Send a missed_topic notification for each missed step
                    missed_names = [s.title for s in missed_steps[:5]]
                    missed_list = ", ".join(missed_names)
                    if len(missed_steps) > 5:
                        missed_list += f" and {len(missed_steps) - 5} more"
                    await send_notification(
                        db, uid,
                        notif_type=NotificationTypeEnum.missed_topic.value,
                        title="Incomplete Tasks Detected ⚠️",
                        message=f"The following modules were not completed on schedule: {missed_list}. They have been rescheduled. Keep going! 💪",
                        action_url="/dashboard",
                    )

                    # Identify impacted sessions to shift the whole roadmap
                    impacted_session_ids = {s.session_id for s in missed_steps}
                    for sess_id in impacted_session_ids:
                        # Shift ALL uncompleted steps for this session forward by 1 working day
                        sess_steps_result = await db.execute(
                            select(LearningStep)
                            .where(
                                LearningStep.session_id == sess_id,
                                LearningStep.is_complete == False
                            )
                        )
                        sess_steps = sess_steps_result.scalars().all()
                        for step in sess_steps:
                            if step.target_date:
                                step.target_date = shift_dates_forward(step.target_date, 1)
                    await db.commit()

                # Also create tomorrow reminder
                await send_notification(
                    db, uid,
                    notif_type=NotificationTypeEnum.tomorrow_reminder.value,
                    title="Tomorrow's Plan",
                    message="Your rescheduled tasks from today are queued for tomorrow. Check your dashboard!",
                )

            await send_notification(
                db, uid,
                notif_type=NotificationTypeEnum.eod_reminder.value,
                title="End-of-Day Summary",
                message=msg,
            )

            # --- Daily Notification Cleanup ---
            # Clear automated system reminders older than 24 hours to keep inbox clean
            from datetime import datetime, timedelta
            yesterday = datetime.utcnow() - timedelta(hours=24)
            await db.execute(
                delete(Notification).where(
                    Notification.user_id == uid,
                    Notification.sent_at < yesterday,
                    Notification.type.in_([
                        NotificationTypeEnum.morning_plan, 
                        NotificationTypeEnum.eod_reminder, 
                        NotificationTypeEnum.tomorrow_reminder,
                        NotificationTypeEnum.missed_topic
                    ])
                )
            )
            await db.commit()


async def weekly_report_job():
    """Sunday night: send weekly performance summary."""
    user_ids = await _get_all_active_users()
    async with AsyncSessionLocal() as db:
        for uid in user_ids:
            from datetime import date, timedelta
            from sqlalchemy import func
            week_ago = (date.today() - timedelta(days=7)).isoformat()
            logs_result = await db.execute(
                select(ProgressLog).where(
                    ProgressLog.user_id == uid,
                    ProgressLog.log_date >= week_ago,
                )
            )
            logs = logs_result.scalars().all()
            if logs:
                total_focus = sum(l.focus_minutes for l in logs)
                total_topics = sum(l.topics_completed for l in logs)
                msg = (
                    f"📊 This week: {total_topics} topics completed, "
                    f"{total_focus} focus minutes logged across {len(logs)} active days. "
                    "Check your dashboard for the full weekly report!"
                )
            else:
                msg = "This week had no learning activity recorded. Jump back in and stay on track!"

            await send_notification(
                db, uid,
                notif_type=NotificationTypeEnum.general.value,
                title="Weekly Performance Report",
                message=msg,
            )


def start_scheduler():
    """Register all cron jobs and start the scheduler."""
    scheduler.add_job(
        morning_plan_job,
        CronTrigger(hour=settings.morning_job_hour, minute=settings.morning_job_minute),
        id="morning_plan",
        replace_existing=True,
    )
    scheduler.add_job(
        eod_reminder_job,
        CronTrigger(hour=settings.eod_job_hour, minute=settings.eod_job_minute),
        id="eod_reminder",
        replace_existing=True,
    )
    scheduler.add_job(
        weekly_report_job,
        CronTrigger(day_of_week="sun", hour=20, minute=0),
        id="weekly_report",
        replace_existing=True,
    )
    scheduler.start()
