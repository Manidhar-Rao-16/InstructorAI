"""
Chat router — agent interaction endpoint.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import Optional
import json

from sqlalchemy.orm import selectinload
from db.database import get_db
from db.models import ChatMessage, UserProfile, ChatSession, User, LearningSession, LearningStep
from schemas.schemas import ChatMessageIn, ChatMessageOut, ChatSessionOut, ChatSessionCreate, StepOut, ChatReplyOut
from auth.dependencies import get_current_user
from agents.orchestrator import process_message, process_message_stream

router = APIRouter(prefix="/chat", tags=["Chat"])
logger = logging.getLogger("instructor_ai")


@router.post("/sessions", response_model=ChatSessionOut)
async def create_chat_session(
    data: Optional[ChatSessionCreate] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new chat session with an optional title.
    Implements deduplication: If a session with the same title exists AND has history,
    return it instead of creating a new "New Chat".
    """
    title = data.title if data and data.title else "New Chat"
    
    # Deduplication for module sessions (titles like "Lesson: ...")
    # If a session with this title exists, ALWAYS return it.
    if title and title != "New Chat":
        existing = await db.execute(
            select(ChatSession)
            .where(ChatSession.user_id == current_user.id, ChatSession.title == title)
            .order_by(ChatSession.created_at.desc())
        )
        found = existing.scalars().first()
        if found:
            return found

    # 2. Prevent creating multiple empty "New Chat" sessions
    if title == "New Chat":
        empty_check = await db.execute(
            select(ChatSession)
            .where(ChatSession.user_id == current_user.id, ChatSession.title == "New Chat")
            .order_by(ChatSession.created_at.desc())
        )
        latest_empty = empty_check.scalar_one_or_none()
        if latest_empty:
            # Check if it actually has messages. If not, reuse it.
            msg_count_res = await db.execute(select(func.count(ChatMessage.id)).where(ChatMessage.chat_session_id == latest_empty.id))
            if msg_count_res.scalar() == 0:
                return latest_empty

    session = ChatSession(user_id=current_user.id, title=title)
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return session


@router.get("/sessions", response_model=list[ChatSessionOut])
async def list_chat_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Retrieve all chat sessions for the user, sorted by recency."""
    # 1. Fetch user's learning sessions WITH steps to identify roadmaps
    ls_result = await db.execute(
        select(LearningSession)
        .where(LearningSession.user_id == current_user.id)
        .options(selectinload(LearningSession.steps))
    )
    learning_sessions = ls_result.scalars().all()
    roadmap_map = {ls.topic: ls for ls in learning_sessions}
    
    # Pre-map chat_session_id to LearningSession for constant-time lookup
    chat_to_ls = {}
    for ls in learning_sessions:
        for step in ls.steps:
            if step.chat_session_id:
                chat_to_ls[step.chat_session_id] = ls

    # 2. Fetch all chat sessions
    result = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.created_at.desc())
    )
    sessions = result.scalars().all()
    
    # 3. Add message counts, is_roadmap flag, and nested modules list
    out = []
    for s in sessions:
        count_res = await db.execute(
            select(func.count(ChatMessage.id)).where(ChatMessage.chat_session_id == s.id)
        )
        s_out = ChatSessionOut.model_validate(s)
        s_out.message_count = count_res.scalar() or 0
        
        # Determine which LearningSession this chat belongs to
        # Priority: 1. Implicitly linked via steps, 2. Explicitly linked by title
        ls = chat_to_ls.get(s.id) or roadmap_map.get(s.title)

        s_out.is_roadmap = ls is not None
        if ls:
            s_out.learning_session_id = ls.id
            # Only include daily modules that have actually been activated/linked to real chat sessions
            visible_steps = [step for step in ls.steps if step.chat_session_id == s.id]
            sorted_steps = sorted(visible_steps, key=lambda x: x.step_number)
            s_out.modules = [StepOut.model_validate(step) for step in sorted_steps]
        out.append(s_out)
    return out


@router.post("/message", response_model=ChatReplyOut)
async def send_message(
    payload: ChatMessageIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a message to the InstructorAI multi-agent system."""
    logger.info(
        "Chat request user_id=%s chat_session_id=%s learning_session_id=%s topic=%s module_title=%s module_content_len=%s query=%r",
        current_user.id,
        payload.chat_session_id,
        payload.session_id,
        payload.topic,
        payload.module_title,
        len(payload.module_content or ""),
        (payload.content or "")[:200],
    )

    # Build user context for agents
    prof_result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    )
    profile = prof_result.scalar_one_or_none()
    # Handle potential None for response_style or profile
    resp_style = "Practical"
    if profile:
        if hasattr(profile.response_style, "value"):
            resp_style = profile.response_style.value
        elif isinstance(profile.response_style, str):
            resp_style = profile.response_style

    context = {
        "user_id": current_user.id,
        "language": profile.current_language if profile else None,
        "proficiency": profile.proficiency_level if profile else None,
        "response_style": resp_style,
        "learning_goal": profile.learning_goal if profile else None,
        "assessment_done": profile.assessment_completed if profile else False,
    }

    # Only build module_context when the frontend actually sent module content
    # (indicates a learning module is truly active). Otherwise pass None so
    # normal chat routing / intent detection applies.
    module_ctx = None
    if payload.module_content and payload.module_content.strip():
        module_ctx = {
            "module_title": payload.module_title or payload.topic or "Current Module",
            "topic": payload.topic,
            "module_content": payload.module_content,
        }

    result = await process_message(
        user_id=current_user.id,
        message=payload.content,
        session_id=payload.session_id,
        chat_session_id=payload.chat_session_id,
        db=db,
        context=context,
        topic=payload.topic,
        module_context=module_ctx,
    )
    reply = (result.get("reply") or "").strip() or "I couldn't generate a response for that module question. Please try again."
    logger.info(
        "Chat response user_id=%s reply_len=%s preview=%r",
        current_user.id,
        len(reply),
        reply[:200],
    )
    return {"reply": reply}


@router.post("/stream")
async def stream_message(
    payload: ChatMessageIn,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Stream AI response token-by-token via Server-Sent Events."""
    logger.info(
        "Chat stream request user_id=%s chat_session_id=%s learning_session_id=%s topic=%s module_title=%s module_content_len=%s query=%r",
        current_user.id,
        payload.chat_session_id,
        payload.session_id,
        payload.topic,
        payload.module_title,
        len(payload.module_content or ""),
        (payload.content or "")[:200],
    )

    # Build user context (same as send_message)
    prof_result = await db.execute(
        select(UserProfile).where(UserProfile.user_id == current_user.id)
    )
    profile = prof_result.scalar_one_or_none()
    resp_style = "Practical"
    if profile:
        if hasattr(profile.response_style, "value"):
            resp_style = profile.response_style.value
        elif isinstance(profile.response_style, str):
            resp_style = profile.response_style

    context = {
        "user_id": current_user.id,
        "language": profile.current_language if profile else None,
        "proficiency": profile.proficiency_level if profile else None,
        "response_style": resp_style,
        "learning_goal": profile.learning_goal if profile else None,
        "assessment_done": profile.assessment_completed if profile else False,
    }

    # Only build module_context when module content is present
    module_ctx = None
    if payload.module_content and payload.module_content.strip():
        module_ctx = {
            "module_title": payload.module_title or payload.topic or "Current Module",
            "topic": payload.topic,
            "module_content": payload.module_content,
        }

    async def event_generator():
        async for event in process_message_stream(
            user_id=current_user.id,
            message=payload.content,
            session_id=payload.session_id,
            chat_session_id=payload.chat_session_id,
            db=db,
            context=context,
            topic=payload.topic,
            module_context=module_ctx,
        ):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        }
    )


@router.delete("/sessions/cleanup")
async def cleanup_duplicate_sessions(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Deletes empty duplicate 'New Chat' sessions and module sessions.
    """
    # 1. Find all sessions for user
    res = await db.execute(
        select(ChatSession)
        .where(ChatSession.user_id == current_user.id)
        .order_by(ChatSession.created_at.desc())
    )
    sessions = res.scalars().all()
    
    deleted_count = 0
    seen_titles = set()
    
    for s in sessions:
        # Check if empty
        m_count = await db.execute(select(func.count(ChatMessage.id)).where(ChatMessage.chat_session_id == s.id))
        is_empty = m_count.scalar() == 0
        
        if is_empty:
            # We keep the MOST RECENT one for each title. Since we sorted by created_at DESC, the first one seen is latest.
            if s.title in seen_titles:
                await db.delete(s)
                deleted_count += 1
            else:
                seen_titles.add(s.title)
        else:
            # If it's NOT empty, we definitely keep it and mark title as seen so we don't have empty ones for it.
            seen_titles.add(s.title)
            
    await db.commit()
    return {"status": "success", "deleted_count": deleted_count}


@router.get("/history", response_model=list[ChatMessageOut])
async def get_chat_history(
    session_id: Optional[int] = None,
    topic: Optional[str] = None,
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get recent chat history for the current user, optionally filtered by session and topic."""
    query = select(ChatMessage).where(ChatMessage.user_id == current_user.id)
    if session_id:
        query = query.where(ChatMessage.chat_session_id == session_id)
        
        # If topic is provided, filter by it. 
        # If topic is explicitly an empty string or None, we look for messages with NO topic (General Chat)
        if topic:
            query = query.where(ChatMessage.topic == topic)
        else:
            query = query.where(ChatMessage.topic.is_(None))
        
    result = await db.execute(
        query.order_by(ChatMessage.id.desc())
        .limit(limit)
    )
    messages = result.scalars().all()
    return list(reversed(messages))


@router.delete("/sessions/{session_id}/modules/{step_id}")
async def remove_module_from_session(
    session_id: int,
    step_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Unlink a daily module from a roadmap chat session."""
    from db.models import LearningStep, LearningSession
    
    # Verify ownership via session join
    result = await db.execute(
        select(LearningStep)
        .join(LearningSession)
        .where(
            LearningStep.id == step_id,
            LearningStep.chat_session_id == session_id,
            LearningSession.user_id == current_user.id
        )
    )
    step = result.scalar_one_or_none()
    
    if not step:
        raise HTTPException(status_code=404, detail="Module not found or unauthorized")
        
    step.chat_session_id = None
    await db.commit()
    return {"status": "unlinked"}


@router.delete("/sessions/{session_id}/messages")
async def clear_session_messages(
    session_id: int,
    topic: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Clear chat messages for a session (optionally filtered by topic) without deleting the session itself."""
    session = await db.get(ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")

    from sqlalchemy import delete as sql_delete
    stmt = sql_delete(ChatMessage).where(ChatMessage.chat_session_id == session_id)
    if topic:
        stmt = stmt.where(ChatMessage.topic == topic)
    else:
        stmt = stmt.where(ChatMessage.topic.is_(None))

    await db.execute(stmt)
    await db.commit()
    return {"status": "cleared", "session_id": session_id, "topic": topic}


@router.delete("/sessions/{session_id}")
async def delete_chat_session(
    session_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete a chat session and its messages."""
    session = await db.get(ChatSession, session_id)
    if not session or session.user_id != current_user.id:
        raise HTTPException(status_code=404, detail="Session not found")
    
    await db.delete(session)
    await db.commit()
    return {"status": "deleted"}
