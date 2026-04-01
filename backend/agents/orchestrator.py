"""
Multi-Agent Orchestration System using AutoGen.

Architecture:
  OrchestratorAgent → routes to specialized agents based on intent:
    - AssessmentAgent       – pre-learning questionnaire
    - RoadmapAgent          – personalized roadmap generation
    - TeachingAgent         – step-by-step lessons
    - AssignmentEvaluator   – grade and give feedback
    - ProgressTrackerAgent  – progress queries
    - PomodoroAgent         – timer management
    - ReminderAgent         – scheduling notifications
    - PerformanceMonitor    – weekly/daily analysis
    - AdminMonitorAgent     – admin reports
"""
from __future__ import annotations

import os
import re
import json
import traceback
from datetime import datetime
from typing import Optional, Dict, List, Any

import logging
logger = logging.getLogger("instructor_ai")

from autogen_agentchat.agents import AssistantAgent
from autogen_agentchat.messages import TextMessage
from autogen_ext.models.openai import OpenAIChatCompletionClient
from autogen_core import CancellationToken
from autogen_agentchat.base import TaskResult

from sqlalchemy import select as sa_select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type, retry_if_exception
import openai
from openai import AsyncOpenAI

from config import settings
from db.models import (
    User, UserProfile, LearningStep, LearningSession, Assignment, 
    ChatSession, ChatMessage
)
from agents.tools import (
    create_learning_session,
    get_session_roadmap,
    get_user_stats,
    mark_step_complete,
    save_assessment,
    save_chat_message,
    score_assignment,
    send_notification,
    update_progress_log,
    check_gating_status,
    get_active_learning_session,
)
# from agents.tools import get_exact_resources # Handled inside get_agent_tools to avoid circularity

# --- Retry logic helper ---
def _is_retryable(exception):
    """Exclude non-retryable errors like Authentication (401) or Bad Requests (400)."""
    auth_err = getattr(openai, 'AuthenticationError', None)
    bad_req = getattr(openai, 'BadRequestError', None)
    
    if auth_err and isinstance(exception, auth_err): return False
    if bad_req and isinstance(exception, bad_req): return False
    
    err_str = str(exception).lower()
    if "api_key" in err_str or "authenticate" in err_str or "401" in err_str:
        return False
    return True

async def _safe_run_agent(agent: AssistantAgent, message: str) -> TaskResult:
    """Run the agent with the given message and return the result."""
    return await agent.run(task=message)

# ─── LLM Configuration Routing ──────────────────────────────────────────────

def _get_openrouter_client(model_name: str, temperature: float = 0.0) -> OpenAIChatCompletionClient:

    """Unified client for OpenRouter."""
    api_key = settings.openrouter_api_key or settings.llm_api_key
    base_url = settings.openrouter_base_url or "https://openrouter.ai/api/v1"

    if not api_key or "your_" in str(api_key).lower():
        logger.error(f"AUTHENTICATION: No valid API key found for {model_name}.")
        # We'll return the client anyway, it will fail during completion

    return OpenAIChatCompletionClient(
        model=model_name,
        api_key=api_key,
        base_url=base_url,
        model_info={
            "vision": False,
            "function_calling": True,
            "json_output": True,
            "family": "unknown",
        },
        extra_kwargs={
            "extra_headers": {
                "HTTP-Referer": "https://instructorai.com",
                "X-Title": "InstructorAI",
            }
        },
        temperature=temperature,
        max_tokens=65536,
        timeout=1200,
    )

def _get_gemini_client() -> OpenAIChatCompletionClient:
    """Client for Roadmap generation (using Gemini via OpenRouter)."""
    return _get_openrouter_client("google/gemini-2.0-flash-001")

def _get_openai_client() -> OpenAIChatCompletionClient:
    """Client for the InstructorAI Chatbot (using GPT-4o-mini via OpenRouter)."""
    return _get_openrouter_client("openai/gpt-4o-mini")

def _get_groq_client() -> OpenAIChatCompletionClient:
    """Client for high-speed tasks (using Llama 3.3 via OpenRouter)."""
    return _get_openrouter_client("meta-llama/llama-3.3-70b-instruct")

def _llm_client() -> OpenAIChatCompletionClient:
    """Default fallback client."""
    return _get_openrouter_client(settings.llm_model)


# ─── System Prompts ───────────────────────────────────────────────────────────

# System message constants removed (WELCOME_MESSAGE) as responses are now dynamic.

ORCHESTRATOR_PROMPT = """
You are InstructorAI Orchestrator – the central router of a technical learning platform.
Your responsibilities:
1. Understand user intent from their message.
2. Route to the correct specialist agent.
3. Synthesize final replies before sending to user.

Intent categories:
- "assessment"    → delegate to AssessmentAgent (Gather duration and level from tiers: Foundation, Basic Practitioner, Skilled, Professional, Architect/Master)
- "roadmap"       → delegate to RoadmapAgent (Generate day-wise plan)
- "learn"         → delegate to TeachingAgent (Deliver lessons)
- "assignment"    → delegate to AssignmentEvaluatorAgent
- "progress"      → delegate to ProgressTrackerAgent
- "pomodoro"      → delegate to PomodoroAgent
- "reminder"      → delegate to ReminderAgent
- "performance"   → delegate to PerformanceMonitorAgent
- "admin"         → delegate to AdminMonitorAgent

IMPORTANT: 
- Before generating a roadmap, always go through the AssessmentAgent to get the course duration and learning level.
- Never teach a topic until the roadmap is generated.
"""

ASSESSMENT_PROMPT = """
You are the Assessment Agent for InstructorAI. Your job is to gather onboarding details (Course Name, Duration, Level, and Response Style).

Follow this process:
1. If duration is unknown, ask for it.
2. If level is unknown, ask for it. The level MUST be one of these five:
   - Level 1. Foundation.
   - Level 2 Basic Practitioner
   - Level 3 Skilled
   - Level 4 Professional
   - Level 5 Architect / Master
3. ask for their preferred Response Style: 
   - Socratic (Guide with questions)
   - Practical (Focus on code & tasks)
   - Direct (Straightforward & concise)
   - Academic (Deep theory & concepts)
4. Once you have all details, CALL 'save_assessment'.

IMPORTANT: If the user asks a question that is NOT related to assessment (e.g., "how are you?" or "what is python?"), do NOT repeat the assessment script. Answer them briefly and politely, then gently remind them that completing the assessment helps you build their roadmap.
"""

INSTRUCTOR_PROMPT = """
You are InstructorAI_TeacherAgent. Deliver textbook-quality technical content directly.
- Direct Output: No internal reasoning or meta-commentary (e.g., "Let me think").
- Mission: Answer all queries immediately. Use [CURRENT CHAPTER CONTEXT] to tailor explanations.
- Course Chapters: If message starts with "📅 **COURSE CHAPTER:**", provide a FULL lesson using the provided source material.
- Follow-ups: Answer directly and thoroughly.
- Rules: Never call 'check_gating_status'. Teach/explain unconditionally.
- Adaptation: Use user's style (Practical default). Use markdown, code blocks, and Mermaid diagrams.
- Resources: Provide 📺 YouTube and 🌐 Official Doc links for every topic. You MUST CALL the `get_exact_resources` tool with the topic name before providing links to ensure they are precise and working.
"""

ROADMAP_PROMPT = """
You are the Roadmap Planning Agent. Generate a high-level "Skeleton" roadmap that covers the full progression from absolute beginner to master.

STRUCTURE:
- Tailor the number of milestones to the "Duration" requested by the user. 
- E.g., if the user requests "30 Days", provide roughly 30 milestones. Use as many logical LEVELS as needed to organize them.
- Ensure the total number of milestones effectively covers the entire requested duration.

CONSTRAINT (TOKEN EFFICIENCY):
- Do NOT provide descriptions, code snippets, or introductory text in the 'content' field.
- Use ONLY the technical title for 'content' to minimize tokens.
- No conversational filler.

HOLIDAY RULES (CRITICAL — follow exactly):
- WORKING DAYS are: Monday, Tuesday, Wednesday, Thursday, Friday, AND Saturday. Saturday IS a working day.
- The ONLY weekly holiday is SUNDAY. Skip ONLY Sundays.
- DO NOT skip Saturday. DO NOT skip Monday. They are normal working days.
- Additionally, skip ONLY these specific Indian national holidays:
  2026-01-26, 2026-03-04, 2026-04-03, 2026-04-14, 2026-05-01, 2026-08-15,
  2026-10-02, 2026-12-25, 2027-01-26, 2027-03-04, 2027-04-03, 2027-04-14,
  2027-05-01, 2027-08-15, 2027-10-02, 2027-12-25
- If a date falls on a Sunday or one of the above holidays, skip to the NEXT day (e.g. Sunday → Monday).
- NEVER skip Saturday or Monday unless they appear in the holiday list above.

JSON schema:
{
  "topic": "str", "duration": "str", "language": "str", "proficiency": "Level 1 to 5 Progression",
  "complexity_rating": 5, "complexity_message": "Skeletal progression path",
  "roadmap": [{
    "step_number": int, 
    "title": "CHAPTER TITLE (e.g. Level 1: [Skill Name])", 
    "target_date": "YYYY-MM-DD", 
    "scheduled_time": "HH:MM AM/PM",
    "content": "SHORT TITLE ONLY (Same as title but without level prefix)"
  }]
}

Rules:
0. CRITICAL OPTIMIZATION: Do NOT include "video_url", "website_url", or any other extra fields. We will auto-fill them.

Rules:
1. MANDATORY: ALWAYS use strictly lowercase for all JSON keys (e.g., "topic", "roadmap"). NEVER capitalize keys.
2. Call `create_learning_session` tool instantly with the complete generated roadmap list.
3. After the tool call completes successfully, reply with exactly one word: TERMINATE
4. Do NOT output JSON in your reply text. Do NOT add any chat. ONLY call the tool, then reply TERMINATE.
"""


TEACHING_PROMPT = """ 
You are 'InstructorAI', a world-class technical mentor.

INTERACTION STYLE:
- When a user asks about a new topic or technical concept, DO NOT just give a definition.
- PROPOSE a learning path immediately. Ask:
  1. "Which level should we target? (1. Foundation, 2. Basic Practitioner, 3. Skilled, 4. Professional, or 5. Architect/Master)?"
  2. "How many days do you want to spend learning this topic?"
  3. "On which date do you want to start?"
- Explain that once they provide this, you will generate a roadmap including specific dates and times, accounting for Sundays as holidays.

CORE RULES:
- If delivering a lesson, deliver a structured lecture focused on the Chapter's core concepts followed by 2 tasks.
- Step 1: Start IMMEDIATELY with "## 📖 [Chapter Title]" and deliver a FULL, structured lecture.
- Step 2: Cover: Overview → Core Theory → Deep Dive → Use Cases → Resources.
- Step 3: Only AFTER the lecture is complete, provide exactly 2 Practical Tasks (TASK_1 and TASK_2).

HOW YOU RESPOND:
1. ADAPT TO RESPONSE STYLE: Adapt to the user's preferred style (Socratic, Practical, Direct, Academic).
2. STRUCTURE: Use markdown — headings, bullet points, numbered lists, code blocks.
3. PROGRAMMING TOPICS: You MUST include:
   - Clear, well-commented CODE EXAMPLES.
   - Deep TECHNICAL EXPLANATION of the logic.
   - A Mermaid WORKFLOW DIAGRAM (graph LR or TD). Quote all labels with special characters.
4. NON-PROGRAMMING TOPICS: Provide a comprehensive THEORETICAL EXPLANATION with logical sections.
5. RESOURCES (MANDATORY): Before providing the resources section, you MUST CALL the `get_exact_resources` tool with the chapter topic to get precisely working URLs. 
   - 📺 **Video Explanation**: Use the `video_url` returned by the tool.
   - 🌐 **Reference Website**: Use the `website_url` returned by the tool.
   - If the tool fails or you don't use it, you MUST still provide high-quality links, but never hallucinate 404s.
   - Format: [Title](URL)


PRACTICAL TASKS: After the resources, end your message with exactly 2 tasks formatted as:
TASK_1: [Task Title] | [Task Description]
TASK_2: [Task Title] | [Task Description]

CRITICAL RULES (NON-NEGOTIABLE):
- NEVER output your internal reasoning, thinking process, or chain-of-thought.
- NEVER start with "Let me think..." or "I'll analyze..." or similar meta-commentary.
- NEVER call 'mark_step_complete' while delivering a lecture. 
- ALWAYS respond as a supportive, expert Teacher Agent.
"""

ASSIGNMENT_EVALUATOR_PROMPT = """
You are a world-class technical mentor and instructor, similar to a senior engineer at a top tech company or a dedicated university professor. Your goal is to provide warm, human-like, and highly constructive feedback on assignments.

HOW YOU EVALUATE:
1. BE HUMAN & SUPPORTIVE: Start with a personal greeting. Use phrases like "I've reviewed your work," "Great effort on this," or "This is a solid start." Sound like a person, not a grading machine.
2. DETAIL MATTERS: Don't just list what's wrong. Explain *why* it's problematic and *how* a professional would approach it. 
3. BALANCED FEEDBACK: 
   - Start with 'Strengths': Specifically mention what they got right (e.g., "Your use of list comprehensions here is very idiomatic").
   - Move to 'Areas for Growth': Gently point out bugs or logical gaps. Use a coaching tone: "One thing to watch out for is..." or "You might notice that if input is X, the code might behave Y."
   - End with 'Pro-Tip/Improvements': Give them a high-level architectural insight or a cleaner way to write the same logic.
4. CODE TEST CASES: If the user submitted source code, you MUST generate realistic input/output test cases and state whether their code passes them.
5. SCORE FAIRLY & DYNAMICALLY: Do NOT output a generic fallback score. You must calculate the score dynamically based on the percentage of requirements met, the correctness of the code, and edge cases handled.
   - 100: Flawless, passes all edge cases, perfect style.
   - 90-99: Excellent, minor style or optimization improvements needed.
   - 75-89: Good, functionally correct but misses edge cases or has notable structural issues.
   - 50-74: Needs Work, logical errors, fails some tests.
   - 0-49: Insufficient, missing core logic, unrelated, or syntactically broken.

RESPONSE STRUCTURE:
Your response MUST consist of two parts:

### Part 1: The Mentor's Message
Write a long, beautifully formatted markdown response as if you are talking directly to the student in a chat. Use bullet points, bold text, and code blocks for examples. This is what the user will read.

### Part 2: The Structured Result (HIDDEN)
At the very end of your message, you MUST include exactly ONE line containing a JSON object for the system to process. Do not wrap it in code blocks.
Format: {"score": <ACTUAL_CALCULATED_SCORE_0_TO_100>, "feedback_summary": "Short summary for dashboard", "improvements_summary": "Key takeaway"}

Example of Part 1 tone:
"Hello! I just spent some time going through your solution for the FizzBuzz challenge. I must say, your logic is incredibly clean! I particularly liked how you moved the divisor checks into a helper function—that's a great example of the DRY (Don't Repeat Yourself) principle in action..."
"""

PROGRESS_PROMPT = """
You are the Progress Tracker Agent.

You can:
- Report daily/weekly learning statistics.
- Show percentage completion of roadmap.
- Summarize assignment scores.
- Show streak and focus minutes.

Format responses clearly with markdown tables or lists.
Always motivate the user with encouraging language.
"""

POMODORO_PROMPT = """
You are the Pomodoro Timer Agent.

You manage focus sessions:
- Confirm a 60-minute focus session has started.
- Remind about 5-minute break after focus.
- Log sessions to the database.
- Track total focus analytics.

Responses must be action-oriented and brief.
"""

REMINDER_PROMPT = """
You are the Reminder Agent.

You generate:
1. Morning plans: "Good morning! Today's topic is [X]. Your tasks to complete today: [list]."
2. End-of-day reports: "You completed [X]/[Y] tasks today. Missed: [list]. Rescheduled to tomorrow."
3. Tomorrow previews: "Tomorrow's tasks: [list]."

Always be warm, motivating, and concise.
"""

PERFORMANCE_PROMPT = """
You are the Performance Monitor Agent.

Weekly/daily analysis:
- Review completion rates, focus sessions, assignment scores, missed tasks.
- Identify weak areas (topics with low scores or repeated skips).
- Suggest revised weekly plan.
- Recommend revision topics if score < 70.

Output a structured performance report with recommendations.
"""

ADMIN_PROMPT = """
You are the Admin Monitor Agent.

For admin users:
- Summarize all user learning activity.
- Show who is falling behind (low completion, no activity > 3 days).
- Generate improvement suggestions per user.
- Produce weekly platform-wide reports.

Format responses as tables and bulleted reports.
"""


# ─── Agent Builder ────────────────────────────────────────────────────────────

def create_agent(name: str, system_message: str, model_client, tools: Optional[List] = None) -> AssistantAgent:
    """Factory to create an AssistantAgent following the 0.4 API."""
    return AssistantAgent(
        name=name,
        system_message=system_message,
        model_client=model_client,
        tools=tools or [],
    )

def build_agents(agent_tools: Optional[Dict[str, List]] = None) -> dict[str, AssistantAgent]:
    """Build agents with provider-specific routing and their tools."""
    if agent_tools is None:
        agent_tools = {}

    gemini_client = _get_gemini_client()
    openai_client = _get_openai_client()
    
    agents = {
        "instructor": create_agent(
            name="InstructorAI",
            system_message=INSTRUCTOR_PROMPT,
            model_client=openai_client,
            tools=agent_tools.get("instructor", []),
        ),
        "assessment": create_agent(
            name="AssessmentAgent",
            system_message=ASSESSMENT_PROMPT,
            model_client=gemini_client,
            tools=agent_tools.get("assessment", []),
        ),
        "roadmap": create_agent(
            name="RoadmapAgent",
            system_message=ROADMAP_PROMPT,
            model_client=gemini_client,
            tools=agent_tools.get("roadmap", []),
        ),
        "teaching": create_agent(
            name="InstructorAI_TeacherAgent",
            system_message=TEACHING_PROMPT,
            model_client=openai_client,
            tools=agent_tools.get("teaching", []),
        ),
        "assignment_evaluator": create_agent(
            name="AssignmentEvaluatorAgent",
            system_message=ASSIGNMENT_EVALUATOR_PROMPT,
            model_client=openai_client,
            tools=agent_tools.get("assignment_evaluator", []),
        ),
        "progress": create_agent(
            name="ProgressTrackerAgent",
            system_message=PROGRESS_PROMPT,
            model_client=gemini_client,
            tools=agent_tools.get("progress", []),
        ),
        "pomodoro": create_agent(
            name="PomodoroAgent",
            system_message=POMODORO_PROMPT,
            model_client=gemini_client,
            tools=agent_tools.get("pomodoro", []),
        ),
        "reminder": create_agent(
            name="ReminderAgent",
            system_message=REMINDER_PROMPT,
            model_client=gemini_client,
            tools=agent_tools.get("reminder", []),
        ),
        "performance": create_agent(
            name="PerformanceMonitorAgent",
            system_message=PERFORMANCE_PROMPT,
            model_client=gemini_client,
            tools=agent_tools.get("performance", []),
        ),
        "admin": create_agent(
            name="AdminMonitorAgent",
            system_message=ADMIN_PROMPT,
            model_client=gemini_client,
            tools=agent_tools.get("admin", []),
        ),
    }

    return agents


from autogen_core.tools import FunctionTool

def get_agent_tools(db, user_id) -> Dict[str, List[FunctionTool]]:
    """Create and return database tools mapped to specific agents following the 0.4 API."""
    
    tools_map = {
        "assessment": [],
        "roadmap": [],
        "teaching": [],
        "instructor": [],
        "progress": [],
        "pomodoro": [],
        "reminder": [],
        "performance": [],
        "admin": [],
        "assignment_evaluator": []
    }

    # 1. Assessment Tool
    async def save_assessment_tool(language: str, proficiency: str, learning_goal: str, response_style: Optional[str] = "Practical") -> Dict:
        return await save_assessment(db, user_id, language, proficiency, learning_goal, response_style)

    tools_map["assessment"].append(FunctionTool(
        save_assessment_tool,
        name="save_assessment",
        description="Save user assessment answers and complete profile."
    ))

    # 2. Roadmap Tool
    async def create_learning_session_tool(
        topic: str,
        language: str,
        roadmap: List[Dict],
        duration: Optional[str] = None,
        proficiency: Optional[str] = None,
    ) -> int:
        """Create a new learning session with a roadmap."""
        try:
            if not roadmap:
                logger.error(f"[TOOL ERROR] create_learning_session received EMPTY roadmap for user: {user_id}")
                return -1
            
            result_id = await create_learning_session(db, user_id, topic, language, roadmap, duration, proficiency)
            logger.info(f"[TOOL SUCCESS] create_learning_session: id={result_id}, topic='{topic}', steps={len(roadmap)}")
            return result_id
        except Exception as e:
            logger.error(f"[TOOL EXCEPTION] create_learning_session: {e}", exc_info=True)
            return -1

    tools_map["roadmap"].append(FunctionTool(
        create_learning_session_tool,
        name="create_learning_session",
        description="Create a new learning session with a roadmap. Use this for all roadmap generation requests."
    ))

    # 3. Search Tool
    async def brave_search_tool(query: str) -> str:
        return f"Search results for '{query}': For the most up-to-date information, please visit official documentation (MDN, Python.org, etc.) and reputable YouTube tutorials."

    search_ft = FunctionTool(
        brave_search_tool,
        name="brave_search",
        description="Search for learning resources or technical documentation."
    )
    for agent_key in ["roadmap", "teaching", "instructor"]:
        tools_map[agent_key].append(search_ft)

    # 4. Teaching/Progress Tools
    async def get_active_learning_session_tool() -> Optional[Dict]:
        return await get_active_learning_session(db, user_id)

    async def check_gating_status_tool(session_id: int) -> Dict:
        return await check_gating_status(db, user_id, session_id)

    async def mark_step_complete_tool(
        session_id: int, 
        step_number: int,
        assignment_title: Optional[str] = None,
        assignment_description: Optional[str] = None,
        tasks: Optional[List[Dict]] = None,
    ) -> Dict:
        return await mark_step_complete(db, session_id, step_number, assignment_title, assignment_description, tasks)

    async def update_progress_log_tool(focus_minutes: int = 0, topics_completed: int = 0, assignments_submitted: int = 0) -> Dict:
        return await update_progress_log(db, user_id, focus_minutes, topics_completed, assignments_submitted)

    async def get_exact_resources_tool(topic: str) -> Dict[str, str]:
        from agents.tools import get_exact_resources
        return await get_exact_resources(topic)

    # Register these tools to teaching and instructor agents
    get_active_ft = FunctionTool(
        get_active_learning_session_tool,
        name="get_active_learning_session",
        description="Check current learning progress and active session."
    )
    update_prog_ft = FunctionTool(
        update_progress_log_tool,
        name="update_progress_log",
        description="Update today's progress log."
    )
    get_resources_ft = FunctionTool(
        get_exact_resources_tool,
        name="get_exact_resources",
        description="Fetch exact YouTube and Documentation URLs for a technical topic. Use this before delivering lessons."
    )
    
    for agent_key in ["teaching", "instructor"]:
        tools_map[agent_key].append(get_active_ft)
        tools_map[agent_key].append(update_prog_ft)
        tools_map[agent_key].append(get_resources_ft)
        
        if agent_key == "teaching":
            tools_map[agent_key].append(FunctionTool(
                check_gating_status_tool,
                name="check_gating_status",
                description="Check if user is allowed to proceed to next lesson based on assignments."
            ))
            tools_map[agent_key].append(FunctionTool(
                mark_step_complete_tool,
                name="mark_step_complete",
                description="Mark a learning step as complete."
            ))

    return tools_map


# ─── Orchestration Entry Point ────────────────────────────────────────────────

INTENT_MAP = {
    "assessment": ["assess", "proficiency", "level", "beginner", "intermediate", "advanced", "duration", "days to complete", "assessment"],
    "roadmap": [
        "roadmap", "curriculum", "learning path", "planner_generate_roadmap:",
        "generate a plan", "i need to learn", "i want to learn", "i want to master",
        "i want to study", "help me learn", "make me a plan", "create a plan",
        "build a plan", "teach me", "i need a course", "make a roadmap",
    ],
    "learn": [
        "learn", "teach", "tutorial", "how to", "show me",
        "begin", "lesson", "next", "start lesson", "first day",
        "give me assignment", "give me assignments", "give me questions", "give me problems",
        "question me", "test me", "quiz me", "practice", "challenge me",
        "practice problems", "practice questions", "coding challenge", "exercises",
    ],
    # Only trigger AssignmentEvaluatorAgent when user is actually submitting their work
    "assignment": ["submit", "evaluate my", "grade my", "check my code", "here is my code",
                   "here's my code", "my solution", "my submission", "i have completed",
                   "i finished the assignment", "my answer is"],
    "progress": ["progress", "dashboard", "stats", "how am i doing", "completed", "my score"],
    "pomodoro": ["pomodoro", "timer", "focus", "start timer", "break", "25 min"],
    "reminder": ["reminder", "morning", "today's plan", "tomorrow", "missed"],
    "performance": ["performance", "weekly report", "analysis", "weak areas"],
    "admin": ["admin", "all users", "platform report", "monitor"],
    "greeting": ["hi", "hello", "hey", "hi there", "good morning", "good evening"],
    "doubt": [
        "explain", "how do i", "how does", "what is", "why is",
        "can you tell me", "can you explain", "i don't understand", "not sure about",
        "help me with", "clarify", "meaning of", "definition", "implementation",
        "how to", "how do", "where do i", "logic behind", "code for",
        "solve", "solution", "debug", "error", "problem", "not working", "fails", "explanation", "more detail",
        "summarize", "summary"
    ],
    "general": ["what is this", "who are you", "help",
                "where is", "can you", "tell me about", "about you"],
}


def detect_intent(message: str, assessment_done: bool) -> str:
    # Strip out any injected context blocks to avoid false intent triggers
    clean_message = re.sub(r'\[CONTEXT - Current module:.*?\[END CONTEXT\]', '', message, flags=re.IGNORECASE | re.DOTALL)
    msg_lower = clean_message.lower().strip()

    def contains_any(msg, keywords):
        for kw in keywords:
            # Use word boundaries for all keywords to prevent false positives like "hi" in "this"
            # We escape the keyword to handle special characters, though INTENT_MAP is mostly simple text
            pattern = rf"\b{re.escape(kw.lower())}\b"
            if re.search(pattern, msg):
                return True
        return False

    # Priority 0: Planner internal trigger — ALWAYS generate (never redirect)
    # This prefix is set programmatically by the Planner backend, not the user.
    if msg_lower.startswith("planner_generate_roadmap:"):
        return "roadmap"

    # Priority 0.5: Automated lesson triggers — route COURSE CHAPTER to instructor.
    # With the Content-First UI, the user reads the module on the right pane.
    # The left pane chatbot is purely for Q&A about that content.
    if msg_lower.startswith("i want to start the lesson for:"):
        return "instructor"
    if msg_lower.startswith("course chapter") or msg_lower.startswith("📅 **course chapter"):
        return "instructor"  # Route to Instructor for Q&A, not the structured TeachingAgent path
    if msg_lower.startswith("📅 **daily module:") or msg_lower.startswith("daily module"):
        return "instructor"  # Route Planner daily module prompts to structured lesson generation

    # Priority 0.75: Natural language roadmap request — detect patterns like
    # "I need to learn Python in 5 days" / "I want to learn React in 2 weeks"
    # These should bypass everything and go straight to RoadmapAgent.
    natural_roadmap_pattern = re.search(
        r"(i (need|want) to (learn|master|study)|help me (learn|master|study)|teach me).+\d+.*(day|week|month|hour)",
        msg_lower
    )
    if natural_roadmap_pattern:
        return "roadmap"

    # Priority 1: Explicit submission — user is sending their work for grading
    if contains_any(msg_lower, INTENT_MAP["assignment"]): return "assignment"

    # Priority 2: Roadmap requests from chat — handled directly by RoadmapAgent
    if contains_any(msg_lower, INTENT_MAP["roadmap"]): return "roadmap"

    # Priority 3: Doubt detection — ALWAYS route to instructor for direct questions
    # Elevated priority: Handle doubts/explanations before architectural/structural keywords
    # We check if it looks like a question or contains doubt keywords.
    if contains_any(msg_lower, INTENT_MAP["doubt"]) or msg_lower.endswith("?") or msg_lower.startswith(("what", "how", "why", "can you", "explain", "summarize", "summary")):
        return "instructor"

    # Priority 4: Learn / practice / question requests
    # Only force assessment if they are trying to START a structured lesson/assignment path
    if contains_any(msg_lower, INTENT_MAP["learn"]):
        # If they just want practice questions, let them (instructor will handle)
        if contains_any(msg_lower, ["question", "test", "quiz", "practice", "challenge"]):
            return "learn" if assessment_done else "instructor"
        return "learn" if assessment_done else "assessment"

    # Priority 5: Structural intent keywords
    if contains_any(msg_lower, INTENT_MAP["assessment"]): return "assessment"
    if contains_any(msg_lower, INTENT_MAP["greeting"]): return "greeting"
    if contains_any(msg_lower, INTENT_MAP["progress"]): return "progress"

    # Priority 6: Language / subject keywords → for general questions, route to instructor first
    TECH_KEYWORDS = [
        "python", "javascript", "java", "react", "node", "sql", "html", "css",
        "machine learning", "ml", "ai", "data", "algorithm", "function", "class",
        "loop", "array", "list", "dict", "api", "rest", "flask", "django",
        "git", "linux", "docker", "kubernetes", "aws", "cloud", "security",
        "backend", "frontend", "database", "query", "syntax", "variable", "string"
    ]
    if contains_any(msg_lower, TECH_KEYWORDS):
        return "instructor"

    if contains_any(msg_lower, INTENT_MAP["pomodoro"]): return "pomodoro"
    if contains_any(msg_lower, INTENT_MAP["reminder"]): return "reminder"
    if contains_any(msg_lower, INTENT_MAP["performance"]): return "performance"
    if contains_any(msg_lower, INTENT_MAP["admin"]): return "admin"

    # Default logic: if assessment not done, we usually want assessment
    # BUT if they are asking a general tech question (Priority 3/6 above), 
    # the 'intent' would have already returned 'instructor'.
    if not assessment_done:
        if contains_any(msg_lower, INTENT_MAP["general"]):
            return "instructor" 
        if contains_any(msg_lower, ["assess", "start", "roadmap", "begin"]):
            return "assessment"
        # If the user is just saying random things before assessment, stay in assessment context
        return "assessment"

    return "general"


def _clean_user_message(message: str) -> str:
    """Remove legacy inline module-context wrappers from the raw user message."""
    cleaned = re.sub(
        r'\[CONTEXT - Current module:.*?\[END CONTEXT\]',
        '',
        message or '',
        flags=re.IGNORECASE | re.DOTALL,
    )
    return cleaned.strip()


def _normalize_module_context(module_context: Optional[dict]) -> Optional[dict]:
    """Normalize structured module context sent by the frontend."""
    if not module_context:
        return None

    module_title = str(module_context.get("module_title") or "").strip()
    topic = str(module_context.get("topic") or "").strip()
    module_content = str(module_context.get("module_content") or "").strip()

    if not module_title and not topic and not module_content:
        return None

    return {
        "module_title": module_title or topic or "Current Module",
        "topic": topic or module_title or "General",
        "module_content": module_content,
    }


def _build_module_grounded_prompt(query: str, module_context: dict) -> str:
    """Build the strict module-grounded prompt required by the module chat UI."""
    module_title = module_context.get("module_title") or "Current Module"
    topic = module_context.get("topic") or module_title
    module_content = module_context.get("module_content") or "No module content was provided."
    if len(module_content) > 6000:
        module_content = module_content[:6000] + "\n...(truncated)"

    return (
        f"Module: {module_title}\n"
        f"Topic: {topic}\n"
        f"Content: {module_content}\n\n"
        f"User Question: {query}\n\n"
        "Answer clearly and only based on the module content. "
        "If the module content does not contain enough information, say so plainly."
    )


async def _search_relevant_modules(db: AsyncSession, user_id: int, query: str, limit: int = 5) -> list:
    """Search across all user's learning modules for relevance to the query.
    
    Performs keyword-based matching against module titles (weighted 3x) and
    content, filtering out common stop words. Returns up to `limit` modules
    sorted by descending relevance score.
    """
    result = await db.execute(
        sa_select(LearningStep)
        .join(LearningSession)
        .where(LearningSession.user_id == user_id)
        .order_by(LearningStep.step_number.asc())
    )
    all_steps = result.scalars().all()

    if not all_steps:
        return []

    query_lower = query.lower().strip()
    stop_words = {
        '', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at',
        'to', 'for', 'of', 'and', 'or', 'but', 'with', 'this', 'that', 'it',
        'i', 'me', 'my', 'we', 'you', 'your', 'do', 'does', 'did', 'can',
        'could', 'would', 'should', 'will', 'be', 'been', 'being', 'have',
        'has', 'had', 'not', 'no', 'so', 'if', 'then', 'than', 'too', 'very',
        'just', 'about', 'what', 'how', 'why', 'when', 'where', 'who', 'which',
        'please', 'tell', 'show', 'explain', 'help', 'want', 'need', 'know',
        'understand', 'learn', 'teach', 'more', 'give', 'get',
    }

    query_words = set(re.split(r'\W+', query_lower)) - stop_words
    if not query_words:
        return []

    scored_modules = []
    for step in all_steps:
        title_lower = (step.title or '').lower()
        content_lower = (step.content or '').lower()

        score = 0
        for word in query_words:
            if len(word) < 2:
                continue
            if word in title_lower:
                score += 3          # Title matches weighted higher
            if word in content_lower:
                score += 1

        if score > 0:
            scored_modules.append({
                'title': step.title,
                'content': (step.content or '')[:300],
                'score': score,
                'step_number': step.step_number,
                'session_id': step.session_id,
                'is_complete': step.is_complete,
            })

    scored_modules.sort(key=lambda x: x['score'], reverse=True)
    return scored_modules[:limit]


def _build_module_search_prompt(query: str, relevant_modules: list) -> str:
    """Build a prompt that includes relevant modules from across all learning sessions.
    
    Instead of grounding to a single active module, this prompt lists all
    matching modules so the AI can suggest the most relevant ones to the user.
    """
    if not relevant_modules:
        return query

    modules_text = "The following learning modules from the user's curriculum are relevant to their query:\n\n"
    for i, mod in enumerate(relevant_modules, 1):
        status = "✅ Completed" if mod['is_complete'] else "📖 In Progress"
        modules_text += f"{i}. **{mod['title']}** ({status})\n"
        if mod['content']:
            modules_text += f"   Overview: {mod['content']}\n\n"

    return (
        f"{modules_text}\n"
        f"User Query: {query}\n\n"
        "INSTRUCTIONS: Based on the user's query, identify and suggest the most relevant learning modules "
        "from their curriculum listed above. For each relevant module:\n"
        "1. Explain how it relates to their query\n"
        "2. Provide a brief overview of what the module covers\n"
        "3. Suggest which module they should focus on\n\n"
        "If the query is about a specific concept covered in one of the modules, provide a helpful explanation "
        "using the module content as context. If none of the modules are a good match, answer the question "
        "based on your general knowledge. Be conversational and supportive."
    )


def _extract_reply_from_result(result: TaskResult, prompt: str) -> str:
    """Extract the assistant-visible reply from an AutoGen TaskResult."""
    if not result or not hasattr(result, "messages"):
        return ""

    prompt_text = (prompt or "").strip()

    for msg in reversed(result.messages):
        source = getattr(msg, "source", None)
        role = getattr(msg, "role", None)
        if source in {"User", "user"} or role in {"user", "User"}:
            continue

        content = getattr(msg, "content", None)
        if isinstance(content, list):
            text_parts = []
            for item in content:
                if isinstance(item, str):
                    text_parts.append(item)
                elif hasattr(item, "text") and isinstance(item.text, str):
                    text_parts.append(item.text)
            content = "\n".join(part for part in text_parts if part).strip()

        if isinstance(content, str):
            text = content.strip()
            if not text or text == prompt_text or text.startswith("{"):
                continue
            return text

    return ""


async def _get_recent_history(db: AsyncSession, user_id: int, chat_session_id: Optional[int] = None, limit: int = 5) -> str:
    """
    Load the last `limit` messages for the user and format them as a
    conversation history string to inject into the agent's system prompt.
    """
    query = sa_select(ChatMessage).where(ChatMessage.user_id == user_id)
    if chat_session_id:
        query = query.where(ChatMessage.chat_session_id == chat_session_id)
        
    result = await db.execute(
        query.order_by(ChatMessage.id.desc()).limit(limit)
    )
    messages = list(reversed(result.scalars().all()))
    if not messages:
        return ""

    lines = ["[RECENT CONVERSATION HISTORY - use this to maintain continuity]"]
    for m in messages:
        prefix = "User" if m.role == "user" else f"Assistant ({m.agent_name or 'AI'})"
        lines.append(f"{prefix}: {m.content[:500]}")  # cap each msg at 500 chars
    lines.append("[END OF HISTORY]")
    return "\n".join(lines)


async def process_message(
    user_id: int,
    message: str,
    session_id: Optional[int],
    db: AsyncSession,
    context: Optional[dict] = None,
    chat_session_id: Optional[int] = None,
    topic: Optional[str] = None,
    module_context: Optional[dict] = None,
) -> dict:
    """
    Main entry point: route message to correct agent, get response, persist to DB.
    Returns: {"reply": str, "agent": str, "intent": str}
    """
    try:
        cleaned_message = _clean_user_message(message)
        normalized_module_context = _normalize_module_context(module_context)
        assessment_done = context.get("assessment_done", False) if context else False
        intent = detect_intent(cleaned_message, assessment_done)
        # If there's module context, default to instructor UNLESS it's a specific system intent like greeting
        if normalized_module_context and intent not in ["greeting", "roadmap", "progress"]:
            intent = "instructor"
        
        # 1. ALWAYS persist the user message first to ensure it stays in history even if AI fails
        await save_chat_message(db, user_id, "user", cleaned_message, session_id=session_id, chat_session_id=chat_session_id, topic=topic)
        logger.info(
            "process_message user_id=%s intent=%s chat_session_id=%s learning_session_id=%s topic=%s module_title=%s module_content_len=%s query=%r",
            user_id,
            intent,
            chat_session_id,
            session_id,
            topic,
            normalized_module_context.get("module_title") if normalized_module_context else None,
            len((normalized_module_context or {}).get("module_content", "")),
            cleaned_message[:200],
        )
        
        # Build tools first, then agents
        agent_tools = get_agent_tools(db, user_id)
        agents = build_agents(agent_tools)

        has_module_context = normalized_module_context is not None
        is_chapter_trigger = "course chapter" in cleaned_message.lower() or "lesson:" in cleaned_message.lower() or "daily module:" in cleaned_message.lower()
        is_onboarding_context = not chat_session_id and not has_module_context and not is_chapter_trigger

        if intent == "greeting":
            # Fetch the user's display name from DB for a personalised welcome
            prof_res = await db.execute(sa_select(UserProfile).where(UserProfile.user_id == user_id))
            profile = prof_res.scalar_one_or_none()
            name = profile.display_name if profile and profile.display_name else None

            # Fallback: check the User table (display_name may live there after signup)
            if not name:
                user_res = await db.execute(sa_select(User).where(User.id == user_id))
                user_obj = user_res.scalar_one_or_none()
                if user_obj and user_obj.email:
                    name = user_obj.email.split("@")[0].capitalize()
                else:
                    name = "there"

            first_name = name.split()[0] if name and name != "there" else name

            # Personalize based on whether a learning module is active
            if has_module_context or topic:
                active_topic = topic or (normalized_module_context or {}).get("module_title", "your module")
                reply = (
                    f"Hey {first_name}! 👋 How can I help you today?\n\n"
                    f"I see you're working on **{active_topic}**. "
                    "Feel free to ask me anything about this topic — whether it's explaining a concept, "
                    "walking through code, or clarifying a tricky part. I'm here to help! 💡"
                )
            else:
                reply = (
                    f"Hey {first_name}! 👋 How can I help you today?\n\n"
                    "Here's what I can do for you:\n"
                    "• **Ask me anything** — technical questions, concept explanations, code help\n"
                    "• **Start a learning path** — head to the **Planner** to generate a personalized roadmap\n"
                    "• **Review your progress** — check your dashboard for stats and achievements\n\n"
                    "What would you like to explore? 🚀"
                )

            await save_chat_message(db, user_id, "assistant", reply, agent_name="InstructorAI", session_id=session_id, chat_session_id=chat_session_id, topic=topic)
            return {
                "reply": reply,
                "agent": "InstructorAI",
                "intent": "greeting",
            }

        if intent == "roadmap_redirect":
            # Roadmap generation must happen in the Planner section, not the chat interface
            reply = (
                "📋 **Roadmap generation happens in the Planning section!**\n\n"
                "To create your personalized learning roadmap:\n"
                "1. Navigate to **Planning** in the sidebar.\n"
                "2. Choose or type the topic you want to learn.\n"
                "3. Select your proficiency level and how many days you have.\n"
                "4. Click **Generate Personalized Roadmap** — your plan will be saved and "
                "visible in the **Roadmap** section.\n\n"
                "Once your roadmap is generated, come back here and I'll guide you through "
                "each lesson step by step! 🚀"
            )
            await save_chat_message(db, user_id, "assistant", reply, agent_name="InstructorAI_Chatbot", session_id=session_id, chat_session_id=chat_session_id, topic=topic)
            return {
                "reply": reply,
                "agent": "InstructorAI_Chatbot",
                "intent": "roadmap_redirect",
            }

        # --- Data Enrichment for Logic ---
        context = context or {}
        chapter_context = ""
        user_message_lower = cleaned_message.lower().strip()
        is_chapter_trigger = "course chapter" in user_message_lower or "lesson:" in user_message_lower

        if chat_session_id or is_chapter_trigger:
            # Try to pull context by title if the message is a trigger, or by chat_session_id
            query = sa_select(LearningStep)
            
            # If it's a trigger, the title might be in the message
            if is_chapter_trigger:
                title_match = re.search(r'(?:course chapter|daily module)[:\*\\s]+([^\n\*]+)', message, re.IGNORECASE)
                if title_match:
                    target_title = title_match.group(1).strip().strip('*').strip()
                    query = query.where(LearningStep.title.ilike(f"%{target_title}%"))
            
            if chat_session_id:
                query = query.where(LearningStep.chat_session_id == int(chat_session_id))
            
            # Sort to get the most relevant/first
            query = query.order_by(LearningStep.step_number.asc())
            step_res = await db.execute(query)
            step = step_res.scalars().first()
            if step:
                chapter_context = (
                    f"\n\n[CURRENT CHAPTER CONTEXT]\n"
                    f"Chapter: {step.title}\n"
                    f"Overview: {step.content}\n"
                    f"Status: {'Done' if step.is_complete else 'In Progress'}\n"
                )
                # Store in context for reuse if needed
                context["linked_chapter"] = {
                    "title": step.title,
                    "content": step.content,
                    "session_id": step.session_id,
                    "step_number": step.step_number
                }

        # 1. Get completed titles
        comp_titles_res = await db.execute(
            sa_select(LearningStep.title)
            .join(LearningSession)
            .where(LearningSession.user_id == user_id, LearningStep.is_complete == True)
        )
        completed_topics = [row[0] for row in comp_titles_res]

        # 2. Get average assignment score
        avg_score_res = await db.execute(
            sa_select(func.avg(Assignment.score))
            .where(Assignment.user_id == user_id, Assignment.score.isnot(None))
        )
        avg_score = avg_score_res.scalar() or 0.0

        if context is None:
            context = {}
        
        context["completed_topics"] = completed_topics
        context["avg_score"] = float(avg_score)

        # 3. If learning, get active session info for the tool call
        if intent == "learn":
            
            # If session_id is provided (e.g. from Planner click), use it explicitly
            if session_id:
                active_sess = await get_session_roadmap(db, session_id)
                # Map session_roadmap output to context format
                if active_sess:
                    # We need the current step number. For simplicity, we find the first incomplete step
                    step_res = await db.execute(
                        sa_select(LearningStep)
                        .where(LearningStep.session_id == session_id, LearningStep.is_complete == False)
                        .order_by(LearningStep.step_number.asc())
                        .limit(1)
                    )
                    curr_step = step_res.scalar_one_or_none()
                    
                    context["active_session"] = {
                        "session_id": session_id,
                        "topic": active_sess["topic"],
                        "current_step_number": curr_step.step_number if curr_step else 1,
                        "current_step_title": curr_step.title if curr_step else "Introduction"
                    }
            else:
                active_sess = await get_active_learning_session(db, user_id)
                if active_sess:
                    context["active_session"] = {
                        "session_id": active_sess["session_id"],
                        "topic": active_sess["topic"],
                        "current_step_number": active_sess["current_step_number"],
                        "current_step_title": active_sess["current_step_title"]
                    }

        # Select target agent
        agent_map = {
            "assessment": "assessment",
            "roadmap": "roadmap",       # only reached via planner_generate_roadmap: prefix
            "learn": "instructor",     # Use instructor agent — it handles course chapters + follow-ups
            "assignment": "assignment_evaluator",
            "progress": "progress",
            "pomodoro": "pomodoro",
            "reminder": "reminder",
            "performance": "performance",
            "admin": "admin",
            "general": "instructor",
            "greeting": "instructor",
        }
        
        # Logic override: If intent is explicit, use it.
        # Otherwise, if assessment not done, gently nudge.
        agent_key = agent_map.get(intent, "instructor")
        
        # If the user is definitely in assessment mode, stick with it
        if not assessment_done and intent == "assessment":
            agent_key = "assessment"

        selected_agent = agents[agent_key]

        # Build context-aware system message with conversation history for memory
        extra = ""
        if chapter_context:
            extra += chapter_context
            
        if context:
            extra += f"\n\n[USER CONTEXT - DO NOT REPEAT]\n{json.dumps(context, indent=2)}\n"
            if not assessment_done and intent != "learn" and intent != "instructor":
                extra += "Use this information to personalize your answer. Since 'assessment_done' is false, prioritize guiding them to an an assessment."
            else:
                extra += "Use this information to personalize your answer. Focus strictly on answering the user's current request or teaching the chapter."

        if has_module_context:
            extra += (
                "\n\n[ACTIVE MODULE CONTEXT]\n"
                f"Module Title: {normalized_module_context['module_title']}\n"
                f"Topic: {normalized_module_context['topic']}\n"
                f"Module Content Length: {len(normalized_module_context['module_content'])}\n"
                "\nCRITICAL INSTRUCTION FOR INSTRUCTOR_AI: The user is currently inside an active learning module. "
                "Do NOT propose a new learning path. Do NOT ask for proficiency level or duration. "
                "Answer strictly from the selected module content."
            )

        history_str = await _get_recent_history(db, user_id, chat_session_id=chat_session_id, limit=5)
        if history_str:
            extra += f"\n\n{history_str}"

        # Tools are already registered during build_agents()
        logger.info(f"Initiating run for agent: {selected_agent.name} for user: {user_id}. Active Session Context: {context.get('active_session')}")

        # In AutoGen 0.4, system messages are immutable after construction.
        # Instead, we prepend context into the user's task message.
        context_prefix = extra if extra else ""
        agent_message = cleaned_message
        chapter_title = ""
        chapter_content_text = ""
        
        msg_lower_check = cleaned_message.lower().strip()
        is_chapter_click = (
            msg_lower_check.startswith("course chapter") or 
            "📅 **course chapter" in msg_lower_check or
            msg_lower_check.startswith("i want to start the lesson for:") or
            "📅 **daily module:" in msg_lower_check or
            msg_lower_check.startswith("daily module")
        )
        
        if is_chapter_click:
            title_m = re.search(r'(?:course chapter|daily module)[:\*\\s]+([^\n\*]+)', cleaned_message, re.IGNORECASE)
            if title_m:
                chapter_title = title_m.group(1).strip().strip('*').strip()
            
            content_m = re.search(r'(?:chapter overview|lesson content)[:\s]*\n?(.*)', cleaned_message, re.IGNORECASE | re.DOTALL)
            if content_m:
                chapter_content_text = str(content_m.group(1)).strip()[:500]
            
            if not chapter_title:
                linked_chap = context.get("linked_chapter")
                if linked_chap:
                    chapter_title = linked_chap.get("title", "the current chapter")
            
            agent_message = (
                f"📅 **COURSE CHAPTER:** **{chapter_title or 'the current chapter'}**\n\n"
                f"Chapter Overview: {chapter_content_text or 'See chapter context above.'}\n\n"
                f"[SYSTEM: LECTURE MODE ACTIVATED]\n\n"
                f"Immediately deliver a COMPLETE, expert-level lecture on '{chapter_title}'. "
                f"Do not ask questions first. START your response with the full lesson now. "
                f"Cover: Overview, Core Theory, Deep Dive, Real-World Use Cases, and Resources. "
                f"ONLY after your explanation, provide 2 practical tasks (TASK_1 and TASK_2). "
                f"End with: 'Does this make sense? Ask any questions, or say I\\'m ready for tasks.'"
            )
            logger.info(f"[CHAPTER CLICK] Rewrote message for TeachingAgent: topic='{chapter_title}'")
        elif has_module_context:
            agent_message = _build_module_grounded_prompt(cleaned_message, normalized_module_context)
        elif topic:
            # User is in a module chat but typed their own query (no module_content sent)
            # Search across ALL modules for relevance to their query
            relevant_modules = await _search_relevant_modules(db, user_id, cleaned_message)
            if relevant_modules:
                agent_message = _build_module_search_prompt(cleaned_message, relevant_modules)
                logger.info(
                    "[MODULE SEARCH] Found %d relevant modules for query: %r",
                    len(relevant_modules),
                    cleaned_message[:100],
                )

        # Initiate conversation
        # Prepend context (chapter info, user data, history) into the task message
        if context_prefix:
            agent_message = f"{context_prefix}\n\n---\n\n{agent_message}"
        
        result = None
        reply = "" 
        try:
            result = await _safe_run_agent(selected_agent, agent_message)
        except Exception as chat_err:
            logger.error(f"Agent run failed: {chat_err}")
            err_str = str(chat_err)
            
            # --- THE ROADMAP RESCUE (Direct LLM Rescue) ---
            if intent == "roadmap" or "planner_generate_roadmap" in message:
                logger.info("[RESCUE] Primary Roadmap Agent failed. Attempting Direct LLM Rescue...")
                try:
                    # Use the new client for rescue
                    rescue_client = _get_gemini_client()
                    
                    # Parse the requested duration from the trigger message
                    duration_match = re.search(r'Duration:\s*(\d+)', message)
                    requested_days = int(duration_match.group(1)) if duration_match else 15
                    
                    rescue_response = await rescue_client.create(
                        messages=[
                            TextMessage(role="system", content=f"You are a fallback Roadmap generator. Return ONLY a valid JSON object. STRUCTURE: Provide exactly {requested_days} milestones. NO descriptions, NO code. Just titles. SCHEMA: {{'topic': '...', 'roadmap': [{{'step_number': 1, 'title': 'Level 1: [Skill Name]', 'content': '[Skill Name]'}}]}}", source="System"),
                            TextMessage(role="user", content=f"Generate a skeletal {requested_days}-milestone JSON roadmap for: '{message}'. Organize them into logical progressive levels.", source="User")
                        ]
                    )
                    
                    rescue_json = json.loads(rescue_response.content)
                    await create_learning_session(db, user_id, 
                                                rescue_json.get("topic", "Learning Path"), 
                                                rescue_json.get("language", "English"), 
                                                rescue_json.get("roadmap", []), "Custom", rescue_json.get("proficiency", "Selected Level"))
                    await db.commit()
                    return {
                        "reply": "I encountered a minor issue with my primary planner, but I've successfully built a reliable learning path for you using my backup system! 🛡️ Quick update: You can now view your roadmap in the sidebar.",
                        "agent": "System (Rescue Mode)",
                        "intent": "roadmap"
                    }
                except Exception as rescue_err:
                    logger.error(f"[RESCUE FAILED] {rescue_err}")

            # Specific error reporting for better UX
            if "authentication" in err_str.lower() or "401" in err_str or "api_key" in err_str.lower():
                 return {
                    "reply": f"🚨 **Authentication Error**: My API keys appear to be invalid or expired. Please check your `.env` configuration. (Error: {err_str[:100]})",
                    "agent": "System",
                    "intent": "error",
                    "detail": "api_key_invalid"
                }
            
            if is_chapter_click and chapter_title:
                reply = (
                    f"## 📖 {chapter_title}\n\n"
                    f"I'm experiencing higher demand than usual, so I can't generate the full custom session right now. "
                    f"Here is a key summary of what to focus on:\n\n"
                    f"{chapter_content_text[:500] if chapter_content_text else 'Please review the learning points in your roadmap.'}\n\n"
                    f"**Tip:** Try asking me a specific question about **{chapter_title}** in a moment, and I'll explain it in detail! 💡"
                )
            elif "429" in err_str or "quota" in err_str.lower() or "limit" in err_str.lower():
                reply = "I've hit a temporary high-traffic limit (Rate Limit). Please wait a few seconds and try again! 🚀"
            else:
                reply = f"I encountered a temporary error while generating your lesson. (Error: {err_str[:50]}...)"

        # Extract reply from TaskResult (AutoGen 0.4)
        reply = _extract_reply_from_result(result, agent_message)

        if not reply:
            # Only show this if it was a roadmap — for roadmap, success is measured by DB creation not reply text
            if intent == "roadmap":
                reply = "✅ Your roadmap is being finalized. Please refresh the Planner page in a moment to see your new learning path!"
            else:
                reply = (
                    "I processed your request but the model returned an empty answer. "
                    "Please try again."
                )
            logger.warning(
                "Empty LLM reply user_id=%s agent=%s intent=%s module_title=%s",
                user_id,
                selected_agent.name,
                intent,
                normalized_module_context.get("module_title") if normalized_module_context else None,
            )

        # --- Manual Tool Extraction Safety Net ---
        for tool_name in ["mark_step_complete", "create_learning_session", "save_assessment"]:
            if f"<function={tool_name}" in reply:
                try:
                    import re as _re_tool
                    tag_pattern = _re_tool.compile(rf"<function={tool_name}>(.*?)(?:</function>|$)", _re_tool.DOTALL)
                    match = tag_pattern.search(reply)
                    if match:
                        tool_data_str = match.group(1).strip()
                        if "{" in tool_data_str:
                            last_brace = tool_data_str.rfind("}")
                            if last_brace != -1:
                                tool_data_str = tool_data_str[:last_brace+1]
                        
                        tool_data = json.loads(tool_data_str)
                        
                        if tool_name == "mark_step_complete":
                            from agents.tools import mark_step_complete
                            await mark_step_complete(db, tool_data.get("session_id"), tool_data.get("step_number"), 
                                                   tool_data.get("assignment_title"), tool_data.get("assignment_description"), tool_data.get("tasks"))
                            reply = tag_pattern.sub("", reply).strip() or "Lesson complete! Tasks updated."
                        
                        elif tool_name == "create_learning_session":
                            from agents.tools import create_learning_session
                            # Verification: If AutoGen ALREADY called the tool, 
                            # the result history will show it. We avoid calling it again.
                            call_id = await create_learning_session(db, user_id, tool_data.get("topic"), tool_data.get("language"), 
                                                         tool_data.get("roadmap"), tool_data.get("duration"), tool_data.get("proficiency"))
                            if call_id > 0:
                                reply = tag_pattern.sub("", reply).strip() or f"Your roadmap for **{tool_data.get('topic')}** is ready!"
                            else:
                                reply = tag_pattern.sub("", reply).strip() or "Your roadmap is already updated."
                        
                        elif tool_name == "save_assessment":
                            from agents.tools import save_assessment
                            await save_assessment(db, user_id, tool_data.get("language"), tool_data.get("proficiency"), 
                                                 tool_data.get("learning_goal"), tool_data.get("response_style"))
                            reply = tag_pattern.sub("", reply).strip() or "Assessment saved!"
                except Exception as te:
                    logger.warning(f"Manual extraction failed for {tool_name}: {te}")

        # --- Aggressive JSON fallback parser ---
        if "{" in reply and ("roadmap" in reply.lower() or "[" in reply):
            try:
                j_start = reply.find("{")
                j_end = reply.rfind("}")
                if j_start != -1 and j_end != -1:
                    j_str = reply[j_start:j_end+1]
                    j_data = json.loads(j_str)
                    if isinstance(j_data, dict) and "roadmap" in j_data:
                        from agents.tools import create_learning_session
                        await create_learning_session(db, user_id, j_data.get("topic", "Topic"), j_data.get("language", "English"), 
                                                     j_data.get("roadmap", []), j_data.get("duration"), j_data.get("proficiency"))
                        clean_rep = reply[:j_start].strip() + "\n\n" + reply[j_end+1:].strip()
                        reply = clean_rep.strip() or f"Roadmap for **{j_data.get('topic')}** is ready!"
            except: pass

        # Final cleanup and persist
        import re as _re_final
        reply = _re_final.sub(r'<function=\w+>[\s\S]*?</function>', '', reply).strip()
        reply = _re_final.sub(r'<function=\w+>[\s\S]*', '', reply).strip()
        if not reply:
            reply = "I couldn't generate a readable answer for that question. Please try again."
        
        await save_chat_message(db, user_id, "assistant", reply, agent_name=selected_agent.name, session_id=session_id, chat_session_id=chat_session_id, topic=topic)
        logger.info(
            "process_message reply user_id=%s agent=%s intent=%s reply_len=%s preview=%r",
            user_id,
            selected_agent.name,
            intent,
            len(reply),
            reply[:200],
        )
        
        return {"reply": reply, "agent": selected_agent.name, "intent": intent}

    except Exception as e:
        import openai
        # Version-agnostic check for OpenAI error types
        bad_request_cls = getattr(openai, 'BadRequestError', getattr(openai, 'InvalidRequestError', None))
        rate_limit_cls = getattr(openai, 'RateLimitError', None)

        if bad_request_cls and isinstance(e, bad_request_cls):
             try:
                 # 1. More robust extraction from the error object directly
                 failed_gen = ""
                 if hasattr(e, "response") and e.response is not None:
                     try:
                         # For openai v1+
                         if hasattr(e.response, "json"):
                             error_data = e.response.json()
                             failed_gen = error_data.get("error", {}).get("failed_generation", "")
                         # Version independent
                         elif isinstance(e.response, dict):
                             failed_gen = e.response.get("error", {}).get("failed_generation", "")
                     except Exception:
                         pass
                 
                 # 2. Fallback to regex if response object is missing or hidden
                 if not failed_gen:
                     msg_match = re.search(r"'failed_generation':\s*['\"](.*?)['\"]", str(e), re.DOTALL)
                     if msg_match:
                         failed_gen = msg_match.group(1).replace("\\n", "\n").replace("\\'", "'").replace('\\"', '"')
                 
                 if failed_gen:
                    # Generic extraction for ANY tool call we support in recovery
                    reply_text = failed_gen
                    
                    def try_fix_json(s: str):
                        """Attempts to close unclosed JSON structures."""
                        stack = []
                        for char in s:
                            if char == '{': stack.append('}')
                            elif char == '[': stack.append(']')
                            elif char == '}': 
                                if stack and stack[-1] == '}': stack.pop()
                            elif char == ']':
                                if stack and stack[-1] == ']': stack.pop()
                        return s + "".join(reversed(stack))

                    for tname in ["mark_step_complete", "create_learning_session", "save_assessment"]:
                        if isinstance(failed_gen, str) and f"<function={tname}" in failed_gen:
                            # Extract text before and data after
                            parts = failed_gen.split(f"<function={tname}")
                            reply_text = (parts[0].strip()[:300] + "...") if len(parts[0]) > 300 else parts[0].strip()
                            
                            try:
                                tag_pattern = re.compile(rf"<function={tname}>(.*)", re.DOTALL)
                                match = tag_pattern.search(str(failed_gen))
                                tool_data_str = match.group(1).strip() if match else ""
                                
                                # Even if </function> is missing, try to find the last valid JSON brace
                                if tool_data_str:
                                    last_brace = tool_data_str.rfind("}")
                                    if last_brace != -1:
                                        tool_data_candidate = tool_data_str[:last_brace+1]
                                    else:
                                        tool_data_candidate = tool_data_str
                                    
                                    try:
                                        tool_data = json.loads(tool_data_candidate)
                                    except:
                                        # Very aggressive repair for truncated roadmaps
                                        repaired = try_fix_json(tool_data_candidate)
                                        # If it looks like a list that was cut off, close it
                                        if '"roadmap": [' in repaired and not repaired.strip().endswith(']}'):
                                            if not repaired.strip().endswith(']'): repaired += ']'
                                            if not repaired.strip().endswith('}'): repaired += '}'
                                        tool_data = json.loads(repaired)
                                    
                                    if tname == "mark_step_complete":
                                        await mark_step_complete(db, tool_data.get("session_id"), tool_data.get("step_number"), 
                                                                tool_data.get("assignment_title"), tool_data.get("assignment_description"), tool_data.get("tasks"))
                                        reply_text = f"{reply_text}\n\n---\n**Lesson complete! Your assignments for this step are now ready in the Tasks section.**"
                                    
                                    elif tname == "create_learning_session":
                                        # Ensure topic and other fields exist
                                        topic = tool_data.get("topic") or "New Learning Path"
                                        await create_learning_session(db, user_id, topic, tool_data.get("language", "English"), 
                                                                     tool_data.get("roadmap", []), tool_data.get("duration"), tool_data.get("proficiency"))
                                        reply_text = f"{reply_text}\n\n---\n**Your professional roadmap for {topic} has been generated and saved!**"
                                    
                                    elif tname == "save_assessment":
                                        await save_assessment(db, user_id, tool_data.get("language"), tool_data.get("proficiency"), 
                                                             tool_data.get("learning_goal"), tool_data.get("response_style"))
                                        reply_text = f"{reply_text}\n\n---\n**High-level assessment saved successfully!**"
                            except Exception as tool_e:
                                logger.warning(f"Recovery tool call failed for {tname}: {tool_e}")
                            break # Only process one tool call in recovery
                    if reply_text:
                        await save_chat_message(db, user_id, "assistant", reply_text, agent_name=selected_agent.name, session_id=session_id, chat_session_id=chat_session_id, topic=topic)
                        return {
                            "reply": reply_text,
                            "agent": selected_agent.name,
                            "intent": intent
                        }
             except Exception as inner_e:
                 logger.warning(f"Failed to recover from BadRequestError: {inner_e}")

        # Final error processing
        error_msg = f"Error in process_message: {str(e)}\n{traceback.format_exc()}"
        logger.error(error_msg)
        
        # Log to chat_errors.log
        with open("chat_errors.log", "a") as f:
            f.write(f"\n--- {datetime.utcnow().isoformat()} ---\n")
            f.write(error_msg + "\n")

        if rate_limit_cls and isinstance(e, rate_limit_cls):
            is_course_chapter = "COURSE CHAPTER:" in message
            reply = "I've hit a temporary high-traffic limit. Please wait a few seconds and try again! 🚀"
            if is_course_chapter:
                reply = "I'm experiencing high traffic, but don't worry! I've already shared the chapter overview above. You can start reading that while I prepare the full deep-dive. 📖"
            
            # Extract history from result if available (0.4 style)
            history_list = []
            if result and hasattr(result, 'messages'):
                for msg in result.messages:
                    if isinstance(msg, TextMessage):
                        history_list.append(msg.content)
            
            return {
                "reply": reply,
                "agent": selected_agent.name,
                "intent": intent,
                "detail": "rate_limit_exceeded",
                "history": history_list
            }

        # Catch-all for other connection/API issues to provide a better user message
        friendly_error = "I encountered an internal error while processing your message."
        if "Connection error" in str(e) or "Bearer" in str(e):
            friendly_error = "I'm having trouble connecting to my brain (the AI service). Please check your internet or try again in a few seconds."
        elif "rate limit" in str(e).lower():
             friendly_error = "I'm a bit overwhelmed right now (Rate Limit reached). Please give me a minute to cool down."

        return {
            "reply": f"{friendly_error}\n\n(Error: {str(e)[:50]}...)",
            "agent": "System",
            "intent": "error",
            "detail": str(e)
        }


# ─── Streaming Response Generator ────────────────────────────────────────────

# Model mapping for streaming (mirrors build_agents routing)
AGENT_MODEL_MAP = {
    "instructor": "openai/gpt-4o-mini",
    "teaching": "openai/gpt-4o-mini",
    "assignment_evaluator": "openai/gpt-4o-mini",
    "assessment": "google/gemini-2.0-flash-001",
    "roadmap": "google/gemini-2.0-flash-001",
    "progress": "google/gemini-2.0-flash-001",
    "pomodoro": "google/gemini-2.0-flash-001",
    "reminder": "google/gemini-2.0-flash-001",
    "performance": "google/gemini-2.0-flash-001",
    "admin": "google/gemini-2.0-flash-001",
}

# System prompt mapping for streaming (mirrors build_agents prompts)
AGENT_PROMPT_MAP = {
    "instructor": INSTRUCTOR_PROMPT,
    "teaching": TEACHING_PROMPT,
    "assignment_evaluator": ASSIGNMENT_EVALUATOR_PROMPT,
    "assessment": ASSESSMENT_PROMPT,
    "roadmap": ROADMAP_PROMPT,
    "progress": PROGRESS_PROMPT,
    "pomodoro": POMODORO_PROMPT,
    "reminder": REMINDER_PROMPT,
    "performance": PERFORMANCE_PROMPT,
    "admin": ADMIN_PROMPT,
}

AGENT_NAME_MAP = {
    "instructor": "InstructorAI",
    "teaching": "InstructorAI_TeacherAgent",
    "assignment_evaluator": "AssignmentEvaluatorAgent",
    "assessment": "AssessmentAgent",
    "roadmap": "RoadmapAgent",
    "progress": "ProgressTrackerAgent",
    "pomodoro": "PomodoroAgent",
    "reminder": "ReminderAgent",
    "performance": "PerformanceMonitorAgent",
    "admin": "AdminMonitorAgent",
}


async def process_message_stream(
    user_id: int,
    message: str,
    session_id: Optional[int],
    db: AsyncSession,
    context: Optional[dict] = None,
    chat_session_id: Optional[int] = None,
    topic: Optional[str] = None,
    module_context: Optional[dict] = None,
):
    """
    Async generator that streams AI responses to the frontend while reusing the
    same agent pipeline as the non-streaming chat endpoint.

    This keeps the chatbot, tools, and LLM routing consistent between
    `/chat/message` and `/chat/stream`, avoiding mismatched behavior where the
    streaming endpoint bypasses the main agent orchestration logic.
    """
    try:
        result = await process_message(
            user_id=user_id,
            message=message,
            session_id=session_id,
            db=db,
            context=context,
            chat_session_id=chat_session_id,
            topic=topic,
            module_context=module_context,
        )

        reply = result.get("reply", "") or "I processed your request but could not generate a response. Please try again."
        chunk_size = 80
        for idx in range(0, len(reply), chunk_size):
            yield {"token": reply[idx:idx + chunk_size]}

        yield {
            "done": True,
            "agent": result.get("agent", "InstructorAI"),
            "intent": result.get("intent", "general"),
        }

    except Exception as e:
        logger.error(f"Error in process_message_stream: {e}\n{traceback.format_exc()}")
        error_msg = "I encountered an error while generating the response. Please try again."
        yield {"token": error_msg}
        yield {"done": True, "agent": "System", "intent": "error"}
