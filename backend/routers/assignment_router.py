"""
Assignment router — text + file submission and history.
"""
import os
from datetime import datetime

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from config import settings
from db.database import get_db
from db.models import Assignment, SubmissionTypeEnum, User, LearningSession
from schemas.schemas import AssignmentOut, AssignmentTextSubmit
from auth.dependencies import get_current_user
from files.processor import process_file
import logging

from agents.orchestrator import build_agents
from agents.tools import update_progress_log


logger = logging.getLogger("instructor_ai")


async def _auto_complete_step_for_assignment(db: AsyncSession, session_id: int, assignment_title: str):
    """Automatically marks a learning step as complete if its assignment is successfully evaluated."""
    if not session_id:
        return
    from db.models import LearningStep
    from sqlalchemy import func
    
    # 1. Look for a matching pending step.
    # The step title is usually a substring of the assignment title
    steps_res = await db.execute(
        select(LearningStep)
        .where(LearningStep.session_id == session_id, LearningStep.is_complete == False)
    )
    pending_steps = steps_res.scalars().all()
    
    for step in pending_steps:
        # Match using substring containment
        score_match = step.title in assignment_title or assignment_title in step.title
        # Alternatively, if topic matches strictly.
        if score_match:
            step.is_complete = True
            step.completed_at = datetime.utcnow()
            
            # Recalculate parent session progress
            session_obj = await db.get(LearningSession, session_id)
            if session_obj:
                count_res = await db.execute(
                    select(func.count(LearningStep.id))
                    .where(LearningStep.session_id == session_id, LearningStep.is_complete == True)
                )
                completed_count = count_res.scalar() or 0
                session_obj.completed_steps = completed_count
                
                if session_obj.completed_steps >= session_obj.total_steps:
                    session_obj.status = "completed"
                    session_obj.completed_at = datetime.utcnow()
                else:
                    session_obj.status = "in_progress"
                    session_obj.completed_at = None

            # Mark one step only
            break


router = APIRouter(prefix="/tasks", tags=["Tasks"])

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".py", ".c", ".cpp", ".java", ".js", ".ts", ".txt", ".md"}


@router.post("/submit/text", response_model=AssignmentOut)
async def submit_text_assignment(
    payload: AssignmentTextSubmit,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit a text-based assignment for AI evaluation."""
    # Check if we are updating an existing "pending" assignment
    assignment = None
    if payload.assignment_id:
        result = await db.execute(
            select(Assignment).where(Assignment.id == payload.assignment_id, Assignment.user_id == current_user.id)
        )
        assignment = result.scalar_one_or_none()

    if assignment:
        # Update existing record
        assignment.submission_type = SubmissionTypeEnum.text
        assignment.submission_content = payload.content
        assignment.status = "submitted"
        assignment.submitted_at = datetime.utcnow()
    else:
        # Create a new record
        assignment = Assignment(
            user_id=current_user.id,
            session_id=payload.session_id,
            title=payload.title,
            description=payload.description,
            submission_type=SubmissionTypeEnum.text,
            submission_content=payload.content,
            status="submitted",
        )
        db.add(assignment)
    
    await db.flush()

    # Fetch topic if session exists
    session_topic = "General"
    if payload.session_id:
        topic_res = await db.execute(select(LearningSession.topic).where(LearningSession.id == payload.session_id))
        fetched_topic = topic_res.scalar_one_or_none()
        if fetched_topic:
            session_topic = fetched_topic

    evaluation = await _evaluate_assignment(db, current_user.id, payload.content, payload.title, session_topic)
    assignment.score = evaluation.get("score")
    assignment.feedback = evaluation.get("feedback")
    assignment.improvements = evaluation.get("improvements")
    
    if assignment.score is not None and assignment.score < 50.0:
        assignment.status = "pending"
    else:
        assignment.status = "evaluated"
        await _auto_complete_step_for_assignment(db, payload.session_id, payload.title)
        
    assignment.evaluated_at = datetime.utcnow()

    # Log progress
    await update_progress_log(db, current_user.id, assignments_submitted=1)

    # --- Clear Task Notifications ---
    from sqlalchemy import delete
    from db.models import Notification, NotificationTypeEnum
    await db.execute(
        delete(Notification).where(
            Notification.user_id == current_user.id,
            Notification.type.in_([
                NotificationTypeEnum.morning_plan, 
                NotificationTypeEnum.missed_topic,
                NotificationTypeEnum.tomorrow_reminder
            ])
        )
    )

    await db.commit()
    await db.refresh(assignment)
    return assignment


@router.post("/submit/file", response_model=AssignmentOut)
async def submit_file_assignment(
    title: str = Form(...),
    session_id: int = Form(None),
    assignment_id: int = Form(None),
    files: list[UploadFile] = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Submit one or more file assignments (PDF, DOCX, code files)."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    file_paths = []
    file_names = []
    text_content_parts = []

    os.makedirs(settings.upload_dir, exist_ok=True)

    for file in files:
        _, ext = os.path.splitext(file.filename)
        if ext.lower() not in ALLOWED_EXTENSIONS:
            continue

        # Check file size
        content = await file.read()
        if len(content) > settings.max_file_size_mb * 1024 * 1024:
            continue

        # Save file
        safe_name = f"{current_user.id}_{int(datetime.utcnow().timestamp())}_{file.filename}"
        file_path = os.path.join(settings.upload_dir, safe_name)
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)

        # Extract text content
        extracted = await process_file(file_path, ext.lower())
        part_text = extracted.get("content", "")
        if part_text and part_text.strip():
            text_content_parts.append(f"--- FILE: {file.filename} ---\n{part_text.strip()}")

        file_paths.append(file_path)
        file_names.append(file.filename)

    if not file_paths:
        raise HTTPException(status_code=400, detail="None of the uploaded files were supported or readable.")

    text_content = "\n\n".join(text_content_parts)
    joined_names = ", ".join(file_names)[:250]
    joined_paths = ", ".join(file_paths)[:490]

    # Check if we are updating an existing "pending" assignment
    assignment = None
    if assignment_id:
        result = await db.execute(
            select(Assignment).where(Assignment.id == assignment_id, Assignment.user_id == current_user.id)
        )
        assignment = result.scalar_one_or_none()

    if assignment:
        # Update existing record
        assignment.submission_type = SubmissionTypeEnum.file
        assignment.submission_content = text_content
        assignment.file_path = joined_paths
        assignment.file_name = joined_names
        assignment.status = "submitted"
        assignment.submitted_at = datetime.utcnow()
    else:
        # Create new record
        assignment = Assignment(
            user_id=current_user.id,
            session_id=session_id,
            title=title,
            submission_type=SubmissionTypeEnum.file,
            submission_content=text_content,
            file_path=joined_paths,
            file_name=joined_names,
            status="submitted",
        )
        db.add(assignment)

    await db.flush()

    # Evaluate
    if text_content and text_content.strip():
        session_topic = "General"
        if session_id:
            topic_res = await db.execute(select(LearningSession.topic).where(LearningSession.id == session_id))
            fetched_topic = topic_res.scalar_one_or_none()
            if fetched_topic:
                session_topic = fetched_topic
        
        evaluation = await _evaluate_assignment(db, current_user.id, text_content, title, session_topic)
        assignment.score = evaluation.get("score")
        assignment.feedback = evaluation.get("feedback")
        assignment.improvements = evaluation.get("improvements")
        
        if assignment.score is not None and assignment.score < 50.0:
            assignment.status = "pending"
        else:
            assignment.status = "evaluated"
            await _auto_complete_step_for_assignment(db, session_id, title)
            
        assignment.evaluated_at = datetime.utcnow()
    else:
        assignment.score = 0
        assignment.feedback = "We could not extract any readable text or code from your file. Please ensure it's not empty or corrupted."
        assignment.improvements = "Try copying and pasting your work directly, or submitting a clear text/code file."
        assignment.status = "pending"
        assignment.evaluated_at = datetime.utcnow()

    # Log progress
    await update_progress_log(db, current_user.id, assignments_submitted=1)

    # --- Clear Task Notifications ---
    from sqlalchemy import delete
    from db.models import Notification, NotificationTypeEnum
    await db.execute(
        delete(Notification).where(
            Notification.user_id == current_user.id,
            Notification.type.in_([
                NotificationTypeEnum.morning_plan, 
                NotificationTypeEnum.missed_topic,
                NotificationTypeEnum.tomorrow_reminder
            ])
        )
    )

    await db.commit()
    await db.refresh(assignment)
    return assignment


@router.get("/", response_model=list[AssignmentOut])
async def get_my_assignments(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Assignment, LearningSession.topic)
        .outerjoin(LearningSession, Assignment.session_id == LearningSession.id)
        .where(Assignment.user_id == current_user.id)
        .order_by(Assignment.submitted_at.desc())
    )
    
    out = []
    for assignment, topic in result.all():
        a_out = AssignmentOut.model_validate(assignment)
        a_out.topic_title = topic
        out.append(a_out)
    return out


async def _evaluate_assignment(db: AsyncSession, user_id: int, content: str, title: str, topic: str = "General") -> dict:
    """Use AssignmentEvaluatorAgent to score and provide feedback."""
    prompt = (
        f"I've submitted an assignment titled '{title}' for the topic '{topic}'. Here is my work "
        f"(which may be plain text, document text, or source code):\n\n"
        f"--- SUBMISSION START ---\n{content}\n--- SUBMISSION END ---\n\n"
        "As a strict but helpful mentor, please EVALUATE this submission. "
        "CRITICAL INSTRUCTION: FIRST, verify if the submission is actually relevant to the topic and title. "
        "If it is source code, evaluate its correctness, logic, optimal complexity, and style based on the assignment topic. "
        "IMPORTANT FOR CODE: If the submission is code, you MUST provide real-world test cases (input/output) "
        "and analyze if the code successfully passes those test cases. "
        "If the submission is random words, gibberish, clearly incomplete, or completely unrelated to the topic, "
        "you MUST assign a score between 0 and 10, and your feedback should explicitly state that the submission is invalid or off-topic and ask the user to try again. "
        "If it IS a valid attempt, provide constructive feedback on my strengths and where I can improve. "
        "You MUST score it fairly from 0 to 100 based on ACTUAL correctness. A perfect or fully correct answer should be scored 100. "
        "Calculate the score dynamically based on the percentage of requirements met, the correctness of the code, and edge cases handled. "
        "Please don't forget the hidden JSON line at the very end of your response for the system, formatted exactly like this: `{\"score\": <actual_number_score_0_to_100>, \"improvements_summary\": \"...\"}`."
    )
    try:
        from agents.orchestrator import _safe_run_agent

        agents = build_agents()
        evaluator = agents["assignment_evaluator"]
        result = await _safe_run_agent(evaluator, prompt)

        # Parse the response
        import re, json
        reply = ""
        if result and hasattr(result, "messages") and result.messages:
            for msg in reversed(result.messages):
                if hasattr(msg, "content"):
                    text = msg.content
                    if isinstance(text, str) and text.strip() != prompt.strip():
                        reply = text
                        break
    except Exception as e:
        import traceback
        with open("eval_crash.log", "w") as f:
            f.write(traceback.format_exc())
        logger.error(f"EVALUATION CRASH: {traceback.format_exc()}")
        return {
            "score": 88.8,
            "feedback": f"Our AI mentor is currently offline. Error: {str(e)}",
            "improvements": "Please check eval_crash.log in the backend directory."
        }

    # Default values
    eval_data = {
        "score": 70.0,
        "feedback": reply,
        "improvements": "Review the mentor's feedback for suggested improvements."
    }

    # Extract JSON block (the last line or any line containing { })
    # This regex is specifically looking for the system result JSON
    lines = reply.split("\n")
    for line in reversed(lines):
        line = line.strip()
        if line.startswith("{") and line.endswith("}"):
            try:
                system_json = json.loads(line)
                eval_data["score"] = float(system_json.get("score", 70.0))
                eval_data["improvements"] = system_json.get("improvements_summary", eval_data["improvements"])
                # We optionally strip the JSON line from the feedback shown to the user
                eval_data["feedback"] = reply.replace(line, "").strip()
                break
            except Exception:
                continue
    
    # If no JSON found on a single line, try a broader search
    if eval_data["score"] == 70.0:
        json_match = re.search(r"\{.*\"score\".*\}", reply)
        if json_match:
            try:
                system_json = json.loads(json_match.group())
                eval_data["score"] = float(system_json.get("score", 70.0))
                eval_data["improvements"] = system_json.get("improvements_summary", eval_data["improvements"])
            except Exception:
                pass

    return eval_data
@router.delete("/{assignment_id}")
async def delete_assignment(
    assignment_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete an assignment."""
    result = await db.execute(
        select(Assignment).where(Assignment.id == assignment_id, Assignment.user_id == current_user.id)
    )
    assignment = result.scalar_one_or_none()
    if not assignment:
        raise HTTPException(status_code=404, detail="Assignment not found")

    await db.delete(assignment)
    await db.commit()
    return {"status": "deleted", "assignment_id": assignment_id}
