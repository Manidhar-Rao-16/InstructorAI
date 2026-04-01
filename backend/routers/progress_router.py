"""
Progress & Dashboard router.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from db.database import get_db
from db.models import Assignment, LearningSession, ProgressLog, SubmissionTypeEnum, User, UserProfile
import logging
import re
from datetime import datetime, timedelta
logger = logging.getLogger("instructor_ai")
from schemas.schemas import DashboardOut, ProgressLogOut, SessionOut, RoadmapRequest, StepOut, StepToggleOut
from auth.dependencies import get_current_user
from agents.orchestrator import process_message
from agents.tools import mark_step_complete, generate_tasks_for_step
from utils.date_helpers import shift_dates_forward

router = APIRouter(prefix="/progress", tags=["Progress"])


async def _reschedule_missed_steps(db: AsyncSession, user_id: int):
    """Auto-reschedule any incomplete learning steps whose target_date is in the past."""
    from db.models import LearningStep
    from datetime import date as _date
    today = _date.today().isoformat()

    missed_result = await db.execute(
        select(LearningStep)
        .join(LearningSession)
        .where(
            LearningSession.user_id == user_id,
            LearningStep.is_complete == False,
            LearningStep.target_date.isnot(None),
            LearningStep.target_date < today,
        )
    )
    missed_steps = missed_result.scalars().all()
    if not missed_steps:
        return

    impacted_session_ids = {s.session_id for s in missed_steps}
    for sess_id in impacted_session_ids:
        sess_steps_result = await db.execute(
            select(LearningStep).where(
                LearningStep.session_id == sess_id,
                LearningStep.is_complete == False,
            )
        )
        for step in sess_steps_result.scalars().all():
            if step.target_date and step.target_date < today:
                step.target_date = shift_dates_forward(step.target_date, 1)

    await db.commit()
    logger.info(f"[RESCHEDULE] Rescheduled {len(missed_steps)} missed steps for user {user_id}")


@router.get("/dashboard", response_model=DashboardOut)
async def get_dashboard(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    uid = current_user.id

    # Auto-reschedule any missed steps on every dashboard load
    await _reschedule_missed_steps(db, uid)

    # Sessions
    sess = await db.execute(select(func.count()).where(LearningSession.user_id == uid))
    total_sessions = sess.scalar() or 0
    comp_sess = await db.execute(
        select(func.count()).where(LearningSession.user_id == uid, LearningSession.status == "completed")
    )
    completed_sessions = comp_sess.scalar() or 0

    # Assignments
    asgn = await db.execute(select(func.count()).where(Assignment.user_id == uid))
    total_assignments = asgn.scalar() or 0
    eval_asgn = await db.execute(
        select(func.count()).where(Assignment.user_id == uid, Assignment.status == "evaluated")
    )
    evaluated_assignments = eval_asgn.scalar() or 0
    avg_score_res = await db.execute(
        select(func.avg(Assignment.score)).where(Assignment.user_id == uid, Assignment.score.isnot(None))
    )
    avg_score = avg_score_res.scalar()

    # Profile
    prof = await db.execute(select(UserProfile).where(UserProfile.user_id == uid))
    profile = prof.scalar_one_or_none()

    # Recent logs (last 14 days)
    logs_res = await db.execute(
        select(ProgressLog)
        .where(ProgressLog.user_id == uid)
        .order_by(ProgressLog.log_date.desc())
        .limit(14)
    )
    logs = logs_res.scalars().all()

    # Active Sessions
    active_sess_res = await db.execute(
        select(LearningSession)
        .where(LearningSession.user_id == uid, LearningSession.status != "completed")
        .order_by(LearningSession.started_at.desc())
        .limit(10)
    )
    active_sessions = active_sess_res.scalars().all()

    # Completed Sessions
    comp_sess_res = await db.execute(
        select(LearningSession)
        .where(LearningSession.user_id == uid, LearningSession.status == "completed")
        .order_by(LearningSession.completed_at.desc())
        .limit(10)
    )
    completed_sessions_list = comp_sess_res.scalars().all()

    return DashboardOut(
        total_sessions=total_sessions,
        completed_sessions_count=completed_sessions,
        completion_percentage=round(completed_sessions / max(total_sessions, 1) * 100, 1),
        total_assignments=total_assignments,
        evaluated_assignments=evaluated_assignments,
        avg_score=round(avg_score, 1) if avg_score else None,
        total_focus_minutes=profile.total_focus_minutes if profile else 0,
        streak_days=profile.streak_days if profile else 0,
        recent_logs=[ProgressLogOut.model_validate(l) for l in reversed(logs)],
        active_sessions=[SessionOut.model_validate(s) for s in active_sessions],
        completed_sessions=[SessionOut.model_validate(s) for s in completed_sessions_list],
    )


@router.get("/logs", response_model=list[ProgressLogOut])
async def get_logs(
    days: int = 30,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ProgressLog)
        .where(ProgressLog.user_id == current_user.id)
        .order_by(ProgressLog.log_date.desc())
        .limit(days)
    )
    return list(reversed(result.scalars().all()))


@router.get("/sessions", response_model=list[SessionOut])
async def list_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(LearningSession)
        .where(LearningSession.user_id == current_user.id, LearningSession.status != "completed")
        .order_by(LearningSession.started_at.desc())
    )
    return result.scalars().all()


@router.delete("/sessions/{session_id}")
async def delete_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a learning session and all its associated steps and assignments."""
    result = await db.execute(
        select(LearningSession).where(
            LearningSession.id == session_id, 
            LearningSession.user_id == current_user.id
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    await db.delete(session)
    await db.commit()
    return {"status": "success", "message": "Session deleted"}


@router.post("/generate-roadmap")
async def generate_roadmap(
    payload: RoadmapRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Directly generate a roadmap without creating a persistent chat history (used by Planner)."""
    # Mark user as assessed so the Chatbot stops asking again in the chat tab
    from sqlalchemy import update
    await db.execute(
        update(UserProfile)
        .where(UserProfile.user_id == current_user.id)
        .values(assessment_completed=True)
    )
    await db.commit()

    # Build a simulated internal message for the RoadmapAgent
    duration_match = re.search(r'\d+', payload.duration)
    requested_days = int(duration_match.group()) if duration_match else 7
        
    start_date_str = payload.start_date if payload.start_date else datetime.now().strftime("%Y-%m-%d")
    
    # Prevent the LLM from mirroring ALL CAPS formatting which can break JSON keys or tool calls
    safe_topic = payload.topic
    if safe_topic.isupper():
        safe_topic = safe_topic.title()

    trigger_message = (
        f"planner_generate_roadmap: '{safe_topic}' ({payload.level}). "
        f"Duration: {payload.duration}. Start: {start_date_str}."
    )
    
    # Track start time for robust session detection
    generation_start_time = datetime.utcnow()
    
    # Get session count before
    before_res = await db.execute(select(func.count(LearningSession.id)).where(LearningSession.user_id == current_user.id))
    before_count = before_res.scalar() or 0

    # We use process_message which will correctly route to RoadmapAgent
    # and call create_learning_session tool.
    logger.info(f"[ROADMAP] Triggering agent for topic: {payload.topic}, duration: {payload.duration}")
    
    try:
        result = await process_message(
            user_id=current_user.id,
            message=trigger_message,
            session_id=None,
            chat_session_id=None,
            db=db,
            context={
                "user_id": current_user.id,
                "assessment_done": True
            },
        )
        logger.info(f"[ROADMAP] Agent reply: {result['reply'][:100]}...")
        
        # Check if the agent returned an error intent
        if result.get("intent") == "error":
            return {
                "status": "error",
                "reply": result.get("reply", "Agent encountered an error."),
                "detail": result.get("detail", "Technical error during generation.")
            }
            
    except Exception as e:
        logger.error(f"[ROADMAP] Process message failed: {e}", exc_info=True)
        return {"status": "error", "reply": "Internal error during roadmap generation.", "detail": str(e)}
    
    # Get session count after
    after_res = await db.execute(select(func.count(LearningSession.id)).where(LearningSession.user_id == current_user.id))
    after_count = after_res.scalar() or 0
    
    # ─── Robustness Check ───
    # We check for ANY session created for this user/topic since we started generating
    # This is much more reliable than just counting.
    check_res = await db.execute(
        select(LearningSession).where(
            LearningSession.user_id == current_user.id,
            LearningSession.started_at >= generation_start_time - timedelta(seconds=5)
        )
    )
    latest_session = check_res.scalars().first()
    session_exists = latest_session is not None

    if session_exists:
        return {"status": "success", "reply": result["reply"]}
    else:
        # --- Aggressive JSON Fallback ---
        # If the agent returned a valid-looking JSON roadmap but didn't call the tool, try to parse it.
        # We now check the ENTIRE chat history, not just the last reply.
        try:
            import json as _json
            history = result.get("history", [])
            reply_text = result.get("reply", "")
            
            # Combine history and reply for total scan
            all_text_to_scan = [reply_text] + [m.get("content", "") for m in reversed(history) if m.get("role") != "user"]
            
            for text in all_text_to_scan:
                if not text or not isinstance(text, str): continue
                
                # Strip markdown code fences first (```json ... ``` or ``` ... ```)
                cleaned_text = re.sub(r'```(?:json)?\s*', '', text)
                cleaned_text = re.sub(r'```', '', cleaned_text)
                # Look for JSON block - more robustly searching for the roadmap key
                json_match = re.search(r'(\{[\s\S]*"roadmap"[\s\S]*\})', cleaned_text, re.IGNORECASE)
                if json_match:
                    try:
                        data = _json.loads(json_match.group(1))
                    except _json.JSONDecodeError:
                        # Try to find the tightest matching braces
                        # Find the first { and last } in the cleaned text
                        first_brace = cleaned_text.find('{')
                        last_brace = cleaned_text.rfind('}')
                        if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
                            try:
                                data = _json.loads(cleaned_text[first_brace:last_brace+1])
                            except _json.JSONDecodeError:
                                data = None
                        else:
                            data = None
                        
                    roadmap_data = None
                    if data:
                        roadmap_data = data.get("roadmap") or data.get("ROADMAP") or data.get("Roadmap")

                    if roadmap_data and isinstance(roadmap_data, list):
                        from agents.tools import create_learning_session
                        await create_learning_session(db, current_user.id, data.get("topic") or data.get("TOPIC") or payload.topic, 
                                                     data.get("language") or data.get("LANGUAGE", "English"), roadmap_data, 
                                                     payload.duration, payload.level)
                        await db.commit()
                        return {"status": "success", "reply": "Your roadmap has been successfully generated! You can view it in the sidebar."}
        except Exception as fallback_err:
            logger.error(f"[ROADMAP] Fallback failed: {fallback_err}")

        # If still no session, trigger informative error
        agent_reply = result.get('reply', '')
        logger.warning(f"[ROADMAP] Failed to create session. Agent reply was: {agent_reply}")
        
        # --- Token limit detection ---
        # Check if the reply looks like truncated JSON (AI ran out of tokens mid-generation)
        is_token_limited = False
        if agent_reply:
            # Signs of token truncation: incomplete JSON, ends with partial content
            trimmed = agent_reply.strip()
            has_json_start = '"roadmap"' in trimmed or '```json' in trimmed
            has_json_end = trimmed.endswith('}') or trimmed.endswith('```')
            # If it looks like JSON started but didn't complete properly
            if has_json_start and not has_json_end:
                is_token_limited = True
            # Also check for explicit finish_reason hints in the result
            finish_reason = result.get('finish_reason', '')
            if finish_reason in ('length', 'max_tokens'):
                is_token_limited = True
        
        if is_token_limited:
            return {
                "status": "error",
                "reply": "",
                "detail": "**Token limit reached!** The AI ran out of response space while generating your roadmap. "
                          "This happens with very long durations (60+ days). Try reducing the duration to 30 days or less, "
                          "or split your learning into multiple shorter roadmaps."
            }

        # Check for system environment issues (common cause)
        env_warning = ""
        try:
            import autogen as _autogen
            if hasattr(_autogen, "__version__") and _autogen.__version__ < "0.2.0":
                env_warning = " (CRITICAL: System is running on an outdated AutoGen version. Please restart server using the 'backend/start-backend.sh' script.)"
        except ImportError:
            pass

        error_detail = f"InstructorAI was unable to finalize your roadmap structure.{env_warning} This can happen if the plan is overly complex or the AI reached its response limit."
        
        # We intentionally do not append the raw `agent_reply` here to avoid leaking 
        # system context prompts (like [USER CONTEXT - DO NOT REPEAT]) into the UI.

        return {
            "status": "error", 
            "reply": "",
            "detail": error_detail
        }
@router.get("/sessions/{session_id}/steps", response_model=list[StepOut])
async def get_session_steps(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get all learning steps for a session, enriched with per-step task counts."""
    from db.models import LearningStep
    result = await db.execute(
        select(LearningStep)
        .where(LearningStep.session_id == session_id)
        .order_by(LearningStep.step_number.asc())
    )
    steps = result.scalars().all()

    # Fetch all assignments for this session to compute per-step task counts
    assignments_res = await db.execute(
        select(Assignment).where(Assignment.session_id == session_id)
    )
    all_assignments = assignments_res.scalars().all()

    enriched = []
    for step in steps:
        # Match assignments whose title contains this step's title
        step_tasks = [a for a in all_assignments if step.title in a.title]
        step_out = StepOut.model_validate(step)
        step_out.total_tasks = len(step_tasks)
        step_out.completed_tasks = sum(1 for a in step_tasks if a.status == "evaluated")
        enriched.append(step_out)

    return enriched


@router.patch("/steps/{step_id}/toggle", response_model=StepToggleOut)
async def toggle_step_status(
    step_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually toggle completion status for a learning step."""
    from db.models import LearningStep, LearningSession
    from datetime import datetime
    
    # Verify ownership via session
    result = await db.execute(
        select(LearningStep)
        .join(LearningSession)
        .where(LearningStep.id == step_id, LearningSession.user_id == current_user.id)
    )
    step = result.scalar_one_or_none()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")

    step.is_complete = not step.is_complete
    step.completed_at = datetime.utcnow() if step.is_complete else None
    await db.flush()
    
    # Recalculate session progress
    session = await db.get(LearningSession, step.session_id)
    if session:
        count_res = await db.execute(
            select(func.count(LearningStep.id))
            .where(LearningStep.session_id == step.session_id, LearningStep.is_complete == True)
        )
        completed_count = count_res.scalar() or 0
        session.completed_steps = completed_count
        
        if session.completed_steps >= session.total_steps:
            session.status = "completed"
            session.completed_at = datetime.utcnow()
        else:
            session.status = "in_progress"
            session.completed_at = None

        # ─── Automated Task Generation ───
        if step.is_complete:
            await generate_tasks_for_step(db, current_user.id, session.id, step)

    # ─── Cascade schedule for future steps if completed early ───
    if step.is_complete and step.target_date:
        from datetime import date, datetime, timedelta
        try:
            target_dt = datetime.strptime(step.target_date, "%Y-%m-%d").date()
            today_dt = date.today()
            
            if today_dt < target_dt:
                days_early = (target_dt - today_dt).days
                step.target_date = today_dt.isoformat()
                
                subsequent_res = await db.execute(
                    select(LearningStep)
                    .where(
                        LearningStep.session_id == step.session_id,
                        LearningStep.step_number > step.step_number
                    )
                )
                subsequent_steps = subsequent_res.scalars().all()
                for sub in subsequent_steps:
                    if sub.target_date:
                        try:
                            sub_target = datetime.strptime(sub.target_date, "%Y-%m-%d").date()
                            new_target = sub_target - timedelta(days=days_early)
                            sub.target_date = new_target.isoformat()
                        except ValueError:
                            pass
        except ValueError:
            pass

    await db.commit()
    return {
        "step_id": step.id,
        "is_complete": step.is_complete,
        "completed_steps": session.completed_steps if session else 0
    }


@router.post("/steps/{step_id}/activate")
async def activate_learning_step(
    step_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Proactively activate a learning step and generate 3 assignments immediately."""
    from db.models import LearningStep, LearningSession, ChatSession
    
    # Verify ownership
    result = await db.execute(
        select(LearningStep)
        .join(LearningSession)
        .where(LearningStep.id == step_id, LearningSession.user_id == current_user.id)
    )
    step = result.scalar_one_or_none()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
        
    # ─── Proactive Rescheduling ───
    # If the user manually activates a future module, move it to today
    from datetime import date
    today_str = date.today().isoformat()
    if step.target_date and step.target_date > today_str:
        step.target_date = today_str
        await db.commit() # Save the new date immediately
    
    # ─── Chat Session Linking ───
    # If this step doesn't have a linked chat session, create one
    if not step.chat_session_id:
        session_obj = await db.get(LearningSession, step.session_id)
        if not session_obj:
            raise HTTPException(status_code=404, detail="Parent learning session not found")
            
        chat_title = f"{session_obj.topic}"
        
        # Check if one with same title exists for this user
        existing_sess = await db.execute(
            select(ChatSession)
            .where(ChatSession.user_id == current_user.id, ChatSession.title == chat_title)
        )
        chat_sess = existing_sess.scalars().first()
        
        if not chat_sess:
            chat_sess = ChatSession(user_id=current_user.id, title=chat_title)
            db.add(chat_sess)
            await db.flush() # get id
        
        step.chat_session_id = chat_sess.id
        await db.commit()
    
    # ─── Automated Task Generation at Activation ───
    # Generate tasks immediately so the user can see them in the sidebar
    from agents.tools import generate_tasks_for_step
    await generate_tasks_for_step(db, current_user.id, step.session_id, step)
    await db.commit()
    
    # Verify the chat session actually exists before returning 200
    verify_res = await db.execute(select(ChatSession).where(ChatSession.id == step.chat_session_id))
    if not verify_res.scalar_one_or_none():
         step.chat_session_id = None
         await db.commit()
         raise HTTPException(status_code=404, detail="Chat session could not be linked")

    return {
        "status": "activated", 
        "chat_session_id": step.chat_session_id,
        "target_date": step.target_date
    }
