from __future__ import annotations

import asyncio
import json
import re
import os
import logging
from datetime import datetime, date, timedelta
from typing import Optional, List, Dict

from sqlalchemy import select, func
from sqlalchemy.exc import OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.database import AsyncSessionLocal
from db.models import (
    Assignment, ChatMessage, LearningSession, LearningStep,
    Notification, NotificationTypeEnum, PomodoroSession, ProgressLog,
    SubmissionTypeEnum, User, UserProfile,
)
from utils.search_helpers import fetch_exact_youtube_link, fetch_exact_doc_link

logger = logging.getLogger("instructor_ai")



# ─── Assessment & Roadmap ─────────────────────────────────────────────────────

async def save_assessment(
    db: AsyncSession,
    user_id: int,
    language: str,
    proficiency: str,
    learning_goal: str,
    response_style: Optional[str] = "Practical",
) -> dict:
    """
    Saves the user's initial assessment.
    Updates the UserProfile with the preferred language, proficiency level, 
    learning goal, and chatbot response style persona.
    """
    from db.models import ResponseStyleEnum
    result = await db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    profile = result.scalar_one_or_none()
    
    if profile:
        profile.current_language = language
        profile.proficiency_level = proficiency
        profile.learning_goal = learning_goal
        
        # Mapping string input from agents to the appropriate database Enum
        style_map = {
            "Socratic": ResponseStyleEnum.socratic,
            "Practical": ResponseStyleEnum.practical,
            "Direct": ResponseStyleEnum.direct,
            "Academic": ResponseStyleEnum.academic,
        }
        # Case-insensitive partial matching for robustness
        for key, val in style_map.items():
                profile.response_style = val
                break
        
        profile.assessment_completed = True
        await db.commit()
        
    return {"status": "saved", "user_id": user_id, "language": language}


async def create_learning_session(
    db: AsyncSession,
    user_id: int,
    topic: str,
    language: str,
    roadmap: list[dict],
    duration: Optional[str] = None,
    proficiency: Optional[str] = None,
    complexity_rating: Optional[int] = None,
    complexity_message: Optional[str] = None,
) -> int:
    """
    Creates a new LearningSession and populates individual LearningSteps 
    based on the AI-generated roadmap JSON.
    Also saves a secondary copy of the roadmap as a JSON file for backup/interoperability.
    """
    # ─── Duplicate Check ───
    # Prevent double generation (common with LLM fallbacks + tool execution)
    from datetime import datetime, timedelta
    recent_check = await db.execute(
        select(LearningSession)
        .where(
            LearningSession.user_id == user_id, 
            LearningSession.topic == topic,
            LearningSession.started_at >= datetime.utcnow() - timedelta(seconds=30)
        )
    )
    duplicate = recent_check.scalar_one_or_none()
    if duplicate:
        logger.warning(f"Duplicate session creation blocked for topic: {topic}. Returning existing ID.")
        return duplicate.id
    # --- REAL-TIME EXACT LINK RESOLUTION ---
    # We resolve exact links in parallel to avoid massive latency
    async def _resolve_step_links(s):
        title = s.get("title", "Topic")
        # Try to get exact YouTube link
        if "youtube.com/results" in str(s.get("video_url", "")):
            s["video_url"] = await fetch_exact_youtube_link(title)
        elif not s.get("video_url"):
            s["video_url"] = await fetch_exact_youtube_link(title)
            
        # Try to get exact Doc link
        if "google.com/search" in str(s.get("website_url", "")):
            s["website_url"] = await fetch_exact_doc_link(f"{title} official documentation")
        elif not s.get("website_url"):
            s["website_url"] = await fetch_exact_doc_link(f"{title} documentation")
        return s

    tasks = [_resolve_step_links(step) for step in roadmap]
    roadmap = await asyncio.gather(*tasks)

    session = LearningSession(
        user_id=user_id,
        topic=topic,
        language=language,
        roadmap=json.dumps(roadmap),
        total_steps=len(roadmap),
        complexity_rating=complexity_rating,
        complexity_message=complexity_message,
    )
    db.add(session)
    await db.flush() # Obtain the session.id

    # Create detailed milestones for the current session
    for i, step in enumerate(roadmap, start=1):
        raw_title = step.get("title", f"Topic {i}")
        # Secondary Cleanup: Strip prefixes like "Step 1: ", "Day 1 - ", etc.
        import re
        clean_title = re.sub(r'^(Step|Day|Task|Level|#)\s*\d+[:\- ]*\s*', '', raw_title, flags=re.IGNORECASE)
        
        ls = LearningStep(
            session_id=session.id,
            step_number=i,
            title=clean_title or raw_title,
            content=step.get("content", ""),
            target_date=step.get("target_date"),
            scheduled_time=step.get("scheduled_time"),
        )
        db.add(ls)
        
    # ─── Centralized Chapter Storage ───
    # Store the roadmap in a structured directory format: modules/user_{ID}/{topic}_{session_id}.json
    user_modules_dir = os.path.join(settings.modules_dir, f"user_{user_id}")
    os.makedirs(user_modules_dir, exist_ok=True)
    
    # Sanitize topic for filename
    file_safe_topic = "".join(c for c in topic if c.isalnum() or c in (' ', '_')).rstrip().replace(' ', '_')
    file_path = os.path.join(user_modules_dir, f"{file_safe_topic}_{session.id}.json")
    
    try:
        with open(file_path, "w") as f:
            json.dump({
                "session_id": session.id,
                "topic": topic,
                "language": language,
                "duration": duration,
                "proficiency": proficiency,
                "complexity_rating": complexity_rating,
                "complexity_message": complexity_message,
                "roadmap": roadmap,
                "created_at": datetime.utcnow().isoformat()
            }, f, indent=4)
    except Exception as e:
        print(f"Error saving chapter backup: {e}")

    await db.commit()
    return session.id


async def get_session_roadmap(db: AsyncSession, session_id: int) -> Optional[dict]:
    """Retrieves session details and its parsed roadmap JSON from the DB."""
    result = await db.execute(
        select(LearningSession).where(LearningSession.id == session_id)
    )
    session = result.scalar_one_or_none()
    if not session:
        return None
    return {
        "id": session.id,
        "topic": session.topic,
        "language": session.language,
        "roadmap": json.loads(session.roadmap) if session.roadmap else [],
        "total_steps": session.total_steps,
        "completed_steps": session.completed_steps,
        "status": session.status,
    }


async def get_active_learning_session(db: AsyncSession, user_id: int) -> Optional[dict]:
    """Retrieves the current 'in_progress' session and the next uncompleted step."""
    result = await db.execute(
        select(LearningSession)
        .where(LearningSession.user_id == user_id, LearningSession.status == "in_progress")
        .order_by(LearningSession.started_at.desc())
        .limit(1)
    )
    session = result.scalar_one_or_none()
    if not session:
        return None
    
    # Identify the next milestone the user needs to work on
    step_result = await db.execute(
        select(LearningStep)
        .where(LearningStep.session_id == session.id, LearningStep.is_complete == False)
        .order_by(LearningStep.step_number.asc())
        .limit(1)
    )
    current_step = step_result.scalar_one_or_none()
    
    return {
        "session_id": session.id,
        "topic": session.topic,
        "language": session.language,
        "total_steps": session.total_steps,
        "completed_steps": session.completed_steps,
        "current_step_number": current_step.step_number if current_step else None,
        "current_step_title": current_step.title if current_step else None,
        "roadmap": json.loads(session.roadmap) if session.roadmap else [],
    }


# ─── Progress ─────────────────────────────────────────────────────────────────

async def generate_tasks_for_step(
    db: AsyncSession,
    user_id: int,
    session_id: int,
    step: LearningStep,
    assignment_title: Optional[str] = None,
    assignment_description: Optional[str] = None,
    tasks: Optional[list] = None,
) -> int:
    """
    Helper to generate assignments (tasks) for a specific learning step.
    Used by both automated agent marks and manual user toggles.
    """
    
    # --- Check for existing tasks tailored to this step ---
    # Since tasks are mapped to steps by finding `step.title` in `Assignment.title`,
    # we use the same matching logic to prevent generating tasks again.
    existing_step_tasks_res = await db.execute(
        select(Assignment.id).where(
            Assignment.session_id == session_id,
            Assignment.title.like(f"%{step.title}%")
        )
    )
    if existing_step_tasks_res.scalar_one_or_none():
        logger.info(f"Tasks already exist for step: '{step.title}', skipping generation.")
        return 0

    assignments_created = 0
    effective_tasks = []
    if tasks:
        for t in tasks:
            if isinstance(t, dict):
                effective_tasks.append(t)
            elif isinstance(t, str):
                # If AI sent a list of strings instead of dicts, try to parse them
                task_pattern = re.compile(r"TASK_\d+:\s*(.*?)\s*[\|\-]\s*(.*)", re.IGNORECASE)
                match = task_pattern.search(t)
                if match:
                    effective_tasks.append({
                        "title": match.group(1).strip(),
                        "description": match.group(2).strip()
                    })
                else:
                    # Fallback for plain strings
                    effective_tasks.append({"title": "Practice Task", "description": t})

    # Check for existing tasks to prevent duplicates
    existing_tasks_res = await db.execute(
        select(Assignment.title).where(Assignment.session_id == session_id)
    )
    existing_titles = set(existing_tasks_res.scalars().all())
    
    import openai
    from config import settings
    import re
    
    # Try using LLM to generate proper tasks if not provided
    if not effective_tasks and step.content:
        try:
            client = openai.AsyncOpenAI(
                api_key=settings.openrouter_api_key or settings.llm_api_key,
                base_url=settings.openrouter_base_url or "https://openrouter.ai/api/v1"
            )
            prompt = (
                f"You are a technical mentor. The student is learning '{step.title}'.\n"
                f"Content Context: {step.content[:1500]}\n\n"
                f"Generate exactly 2 practical coding or theory tasks. "
                "Format EXACTLY as:\n"
                "TASK_1: [Title] | [Detailed description and requirements]\n"
                "TASK_2: [Title] | [Detailed description and requirements]"
            )
            resp = await client.chat.completions.create(
                model=settings.llm_model,
                messages=[{"role": "system", "content": "You are a helpful coding instructor."},
                          {"role": "user", "content": prompt}],
                max_tokens=500,
                temperature=0
            )
            ai_text = resp.choices[0].message.content
            task_pattern = re.compile(r"TASK_\d+:\s*(.*?)\s*[\|\-]\s*(.*)", re.IGNORECASE)
            for line in ai_text.split("\n"):
                match = task_pattern.search(line)
                if match:
                    effective_tasks.append({
                        "title": match.group(1).strip(),
                        "description": match.group(2).strip()
                    })
        except Exception as e:
            print(f"Error generating tasks: {e}")

    # Regex fallback if AI generation failed or wasn't used
    if not effective_tasks and assignment_description:
        task_pattern = re.compile(r"TASK_\d+:\s*(.*?)\s*[\|\-]\s*(.*)", re.IGNORECASE)
        lines = assignment_description.split("\n")
        for line in lines:
            match = task_pattern.search(line)
            if match:
                effective_tasks.append({
                    "title": match.group(1).strip(),
                    "description": match.group(2).strip()
                })

    if effective_tasks:
        for task in effective_tasks:
            base_t_title = task.get("title") or assignment_title or f"Task: {step.title}"
            
            # Ensure the module name is included for the frontend grouping
            if " - " not in base_t_title and ": " not in base_t_title:
                t_title = f"{base_t_title} - {step.title}"
            else:
                t_title = base_t_title

            if t_title in existing_titles:
                continue
            t_desc = task.get("description") or assignment_description or step.content or ""
            new_assignment = Assignment(
                user_id=user_id,
                session_id=session_id,
                title=t_title,
                description=t_desc,
                submission_type=SubmissionTypeEnum.text,
                status="pending",
            )
            db.add(new_assignment)
            assignments_created += 1
            existing_titles.add(t_title)
    else:
        # Absolute Fallback: Create structured 3-part progression
        fallbacks = [
            {"suffix": "Core Exercise", "prefix": "Task 1: Essential Practice - "},
            {"suffix": "Application", "prefix": "Task 2: Practical Implementation - "},
            {"suffix": "Expansion", "prefix": "Task 3: Challenge & Review - "},
        ]
        for f in fallbacks:
            t_title = f"{f['prefix']}{step.title}"
            if t_title in existing_titles:
                continue
            new_assignment = Assignment(
                user_id=user_id,
                session_id=session_id,
                title=t_title,
                description=f"Apply concepts from '{step.title}' to this {f['suffix']}.\n\nContext:\n{step.content[:400]}...",
                submission_type=SubmissionTypeEnum.text,
                status="pending",
            )
            db.add(new_assignment)
            assignments_created += 1
            existing_titles.add(t_title)
            
    if assignments_created > 0:
        await send_notification(
            db, user_id,
            notif_type="general",
            title="New Tasks Available! 📝",
            message=f"I've generated {assignments_created} new task(s) based on your progress in '{step.title}'. Check them out in the Tasks section.",
            action_url="/tasks"
        )

    return assignments_created


async def mark_step_complete(
    db: AsyncSession, 
    session_id: int, 
    step_number: int,
    assignment_title: Optional[str] = None,
    assignment_description: Optional[str] = None,
    tasks: Optional[list] = None,
) -> dict:
    """
    Marks a learning step as completed and updates aggregate session progress.
    Crucially, this function also triggers the creation of Assignments (tasks).
    """
    result = await db.execute(
        select(LearningStep).where(
            LearningStep.session_id == session_id,
            LearningStep.step_number == step_number,
        )
    )
    step = result.scalar_one_or_none()
    
    assignments_created = 0
    if step and not step.is_complete:
        step.is_complete = True
        step.completed_at = datetime.utcnow()

        # Increment session completion counters
        sess_result = await db.execute(select(LearningSession).where(LearningSession.id == session_id))
        session = sess_result.scalar_one_or_none()
        
        if session:
            session.completed_steps += 1
            if session.completed_steps >= session.total_steps:
                session.status = "completed"
                session.completed_at = datetime.utcnow()
            
            assignments_created = await generate_tasks_for_step(
                db, session.user_id, session_id, step, 
                assignment_title, assignment_description, tasks
            )

            # ─── Write to ProgressLog so charts populate ───────────────────
            await update_progress_log(
                db,
                user_id=session.user_id,
                topics_completed=1,
                topics_studied=1,
            )
            
            # --- Clear Task Notifications ---
            from sqlalchemy import delete
            from db.models import Notification, NotificationTypeEnum
            await db.execute(
                delete(Notification).where(
                    Notification.user_id == session.user_id,
                    Notification.type.in_([
                        NotificationTypeEnum.morning_plan, 
                        NotificationTypeEnum.missed_topic,
                        NotificationTypeEnum.tomorrow_reminder
                    ])
                )
            )
            
        await db.commit()

    return {"status": "marked", "step": step_number, "assignments_generated": assignments_created}


async def update_progress_log(
    db: AsyncSession,
    user_id: int,
    focus_minutes: int = 0,
    topics_completed: int = 0,
    topics_studied: int = 0,
    assignments_submitted: int = 0,
) -> dict:
    """
    Updates today's daily ProgressLog.
    If no log exists for the current date, a new one is initialized.
    Used for aggregate dashboard graphs.
    """
    today = date.today().isoformat()
    result = await db.execute(
        select(ProgressLog).where(
            ProgressLog.user_id == user_id,
            ProgressLog.log_date == today,
        )
    )
    log = result.scalar_one_or_none()
    
    if log:
        log.focus_minutes += focus_minutes
        log.topics_completed += topics_completed
        log.topics_studied += topics_studied
        log.assignments_submitted += assignments_submitted
    else:
        log = ProgressLog(
            user_id=user_id,
            log_date=today,
            focus_minutes=focus_minutes,
            topics_completed=topics_completed,
            topics_studied=topics_studied,
            assignments_submitted=assignments_submitted,
        )
        db.add(log)
        
    await db.commit()
    return {"status": "updated", "date": today}


# ─── Assignments ──────────────────────────────────────────────────────────────

async def score_assignment(
    db: AsyncSession,
    assignment_id: int,
    score: float,
    feedback: str,
    improvements: str,
) -> dict:
    """Stores evaluation results and feedback for an assignment submission."""
    result = await db.execute(select(Assignment).where(Assignment.id == assignment_id))
    assignment = result.scalar_one_or_none()
    if assignment:
        assignment.score = score
        assignment.feedback = feedback
        assignment.improvements = improvements
        assignment.status = "evaluated"
        assignment.evaluated_at = datetime.utcnow()
        await db.commit()
    return {"status": "scored", "assignment_id": assignment_id, "score": score}


async def check_gating_status(db: AsyncSession, user_id: int, session_id: int) -> dict:
    """
    Implements learning gates (SOFT GATE). 
    User can always proceed, but receives a reminder if assignments are pending.
    """
    # Last milestone achieved
    result = await db.execute(
        select(LearningStep)
        .where(LearningStep.session_id == session_id, LearningStep.is_complete == True)
        .order_by(LearningStep.step_number.desc())
        .limit(1)
    )
    last_completed_step = result.scalar_one_or_none()
    
    if not last_completed_step:
        return {"can_proceed": True, "message": "Starting the first session."}
    
    # Look for active submissions
    a_result = await db.execute(
        select(Assignment)
        .where(Assignment.user_id == user_id, Assignment.session_id == session_id)
        .order_by(Assignment.submitted_at.desc())
        .limit(1)
    )
    last_assignment = a_result.scalar_one_or_none()
    
    # User can ALWAYS proceed per the latest educational guidance rules
    if not last_assignment:
        return {
            "can_proceed": True, 
            "message": f"Note: You haven't started the assignment for '{last_completed_step.title}' yet, but feel free to continue! I'm here to help."
        }
    
    if last_assignment.status == "pending":
         return {
            "can_proceed": True, 
            "message": "Note: Your previous assignment is awaiting submission. You can still proceed smoothly!"
        }
        
    return {"can_proceed": True, "message": "Gate cleared."}


# ─── Pomodoro ─────────────────────────────────────────────────────────────────

async def log_pomodoro_complete(
    db: AsyncSession,
    session_id: int,
    completed: bool,
    interrupted: bool,
) -> dict:
    """Updates a focus session record with final completion/interruption status."""
    result = await db.execute(select(PomodoroSession).where(PomodoroSession.id == session_id))
    pomo = result.scalar_one_or_none()
    if pomo:
        pomo.completed = completed
        pomo.interrupted = interrupted
        pomo.ended_at = datetime.utcnow()
        await db.commit()
    return {"status": "logged", "session_id": session_id}


async def update_live_focus_time(
    db: AsyncSession,
    user_id: int,
    delta_seconds: int,
) -> dict:
    """
    Live sync tool for the persistent timer.
    Increments total focus minutes in UserProfile and update today's daily log.
    Accepts delta in seconds and performs flooring/aggregation.
    """
    prof_result = await db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    profile = prof_result.scalar_one_or_none()
    
    minutes_to_add = delta_seconds // 60
    if minutes_to_add > 0:
        if profile:
            profile.total_focus_minutes += minutes_to_add
            
        today = date.today().isoformat()
        log_result = await db.execute(
            select(ProgressLog).where(
                ProgressLog.user_id == user_id,
                ProgressLog.log_date == today,
            )
        )
        log = log_result.scalar_one_or_none()
        if log:
            log.focus_minutes += minutes_to_add
        else:
            log = ProgressLog(
                user_id=user_id,
                log_date=today,
                focus_minutes=minutes_to_add,
            )
            db.add(log)
        
        await db.commit()
    return {"status": "updated", "delta_seconds": delta_seconds}


# ─── Notifications ────────────────────────────────────────────────────────────

async def send_notification(
    db: AsyncSession,
    user_id: int,
    notif_type: str,
    title: str,
    message: str,
    action_url: Optional[str] = None,
) -> dict:
    """Persists a system notification record for a user to see in their inbox."""
    notif = Notification(
        user_id=user_id,
        type=notif_type,
        title=title,
        message=message,
        action_url=action_url,
    )
    db.add(notif)
    print("DEBUG: Executing db.commit()...")
    await db.commit()
    print(f"DEBUG: Notification {notif.id} committed successfully.")
    return {"status": "sent", "user_id": user_id, "type": notif_type}


# ─── User Stats ───────────────────────────────────────────────────────────────

async def get_user_stats(db: AsyncSession, user_id: int) -> dict:
    """Aggregates high-level metrics for a user. Used by agents and admin dashboard."""
    # Total chapters created
    sess_count = await db.execute(
        select(func.count()).where(LearningSession.user_id == user_id)
    )
    total_sessions = sess_count.scalar() or 0

    # Completed sessions
    comp_count = await db.execute(
        select(func.count()).where(
            LearningSession.user_id == user_id,
            LearningSession.status == "completed",
        )
    )
    completed_sessions = comp_count.scalar() or 0

    # Avg assignment score
    avg_score_result = await db.execute(
        select(func.avg(Assignment.score)).where(
            Assignment.user_id == user_id,
            Assignment.score.isnot(None),
        )
    )
    avg_score = avg_score_result.scalar()

    # Total focus minutes
    prof_result = await db.execute(select(UserProfile).where(UserProfile.user_id == user_id))
    profile = prof_result.scalar_one_or_none()

    return {
        "user_id": user_id,
        "total_sessions": total_sessions,
        "completed_sessions": completed_sessions,
        "completion_pct": round(completed_sessions / max(total_sessions, 1) * 100, 1),
        "avg_score": round(avg_score, 1) if avg_score else None,
        "total_focus_minutes": profile.total_focus_minutes if profile else 0,
        "streak_days": profile.streak_days if profile else 0,
    }


async def save_chat_message(
    db: AsyncSession,
    user_id: int,
    role: str,
    content: str,
    agent_name: Optional[str] = None,
    session_id: Optional[int] = None,
    chat_session_id: Optional[int] = None,
    topic: Optional[str] = None,
) -> int:
    """Persist a chat message using a short-lived write session.

    Using an independent transaction here keeps long-running streaming requests
    from holding onto the main request session and reduces SQLite lock
    contention when the UI polls history/sessions in parallel.
    """
    from db.models import ChatSession

    for attempt in range(3):
        try:
            async with AsyncSessionLocal() as write_db:
                msg = ChatMessage(
                    user_id=user_id,
                    role=role,
                    content=content,
                    agent_name=agent_name,
                    session_id=session_id,
                    chat_session_id=chat_session_id,
                    topic=topic,
                )
                write_db.add(msg)

                # Update session: auto-title + bump updated_at for history grouping
                if chat_session_id:
                    sess_result = await write_db.execute(select(ChatSession).where(ChatSession.id == chat_session_id))
                    session = sess_result.scalar_one_or_none()
                    if session:
                        # Bump updated_at so sidebar groups by last activity
                        session.updated_at = datetime.utcnow()

                        # Auto-update session title if it's the first user message
                        if role == "user" and session.title == "New Chat":
                            is_daily_module = re.search(r'📅\s*\*{0,2}DAILY MODULE:\*{0,2}\s*', content, re.IGNORECASE)
                            if not is_daily_module:
                                session.title = (content[:40] + "...") if len(content) > 40 else content

                await write_db.commit()
                await write_db.refresh(msg)
                return msg.id
        except OperationalError as exc:
            if "database is locked" not in str(exc).lower() or attempt == 2:
                raise
            await asyncio.sleep(0.2 * (attempt + 1))
async def get_exact_resources(topic: str) -> Dict[str, str]:
    """
    Programmatically fetches the exact first YouTube and Documentation URL for a topic.
    Use this to provide precise links in lessons instead of generic search queries.
    """
    video_task = fetch_exact_youtube_link(topic)
    doc_task = fetch_exact_doc_link(f"{topic} official documentation")
    
    video_url, website_url = await asyncio.gather(video_task, doc_task)
    
    return {
        "video_url": video_url,
        "website_url": website_url
    }
