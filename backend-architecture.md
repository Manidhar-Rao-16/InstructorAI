---
description: Backend architecture and file interlinking workflow for InstructorAI
---

# InstructorAI Backend Architecture & File Interlinking

This document describes how every backend file connects to every other file, the data flow between components, and the overall system architecture.

## 1. Application Bootstrap (`main.py`)

The entry point. It initializes the FastAPI app and wires everything together.

**Startup sequence:**
1. `create_tables()` → calls `db/database.py` to create all SQLAlchemy tables
2. `_seed_admin()` → uses `auth/service.py` (`hash_password`) and `db/models.py` (`User`, `UserProfile`)
3. `start_scheduler()` → starts `scheduler.py` background jobs
4. Creates `uploads/` and `uploads/modules/` directories from `config.py` settings

**Router registration:**
All 8 routers from `routers/` are included under the `/api` prefix.

**Middleware:**
- Request logging middleware (logs every request/response)
- Global exception handler (writes to `error_trace.log`)
- CORS middleware (configured from `config.py`)

---

## 2. Configuration (`config.py`)

**Central settings hub** — imported by almost every file.

Reads `.env` via `pydantic-settings` and exposes:
- LLM API keys and base URLs (OpenRouter, OpenAI, Gemini, Groq)
- JWT secrets, Google OAuth credentials
- Database URL, file paths, SMTP settings
- Scheduler cron times, admin credentials

**Consumed by:** `main.py`, `db/database.py`, `auth/service.py`, `agents/orchestrator.py`, `agents/tools.py`, `api/llm_client.py`, `scheduler.py`, all routers.

---

## 3. Database Layer (`db/`)

### `db/database.py`
- Creates async SQLAlchemy engine from `config.settings.database_url`
- Configures SQLite WAL mode for concurrent access
- Exports: `engine`, `AsyncSessionLocal`, `Base`, `get_db()` (FastAPI dependency), `create_tables()`

### `db/models.py`
- Defines all 10 ORM models inheriting from `Base`
- **User** → has relationships to: `UserProfile`, `LearningSession`, `Assignment`, `PomodoroSession`, `ProgressLog`, `Notification`, `ChatMessage`, `ChatSession`
- **UserProfile** → stores preferences (language, proficiency, response_style, focus_minutes, streak)
- **LearningSession** → contains roadmap JSON, links to `LearningStep[]` and `Assignment[]`
- **LearningStep** → individual milestones, optionally linked to a `ChatSession`
- **Assignment** → submissions with score/feedback, linked to `LearningSession`
- **PomodoroSession** → focus timer records
- **ProgressLog** → daily aggregated stats
- **Notification** → system/educational notifications
- **ChatSession** → groups chat messages
- **ChatMessage** → individual messages with role/agent_name

**Consumed by:** Every router, `agents/tools.py`, `agents/orchestrator.py`, `scheduler.py`.

---

## 4. Authentication (`auth/`)

### `auth/service.py`
- `hash_password()` / `verify_password()` — bcrypt operations
- `create_access_token()` / `decode_token()` — JWT encode/decode using `config.settings`

### `auth/dependencies.py`
- `get_current_user()` — FastAPI dependency that extracts JWT from Bearer header → queries `User` from DB
- `require_admin()` — wraps `get_current_user()` with role check

**Consumed by:** `main.py` (admin seeding), all routers (auth guard).

---

## 5. Schemas (`schemas/schemas.py`)

Pydantic request/response models for every API endpoint:
- Auth: `UserCreate`, `UserLogin`, `GoogleLoginRequest`, `Token`, `UserOut`
- Profile: `ProfileUpdate`, `ProfileOut`
- Chat: `ChatMessageIn`, `ChatReplyOut`, `ChatSessionCreate`, `ChatSessionOut`, `ChatMessageOut`
- Learning: `SessionOut`, `RoadmapRequest`, `StepOut`, `StepToggleOut`
- Assignment: `AssignmentTextSubmit`, `AssignmentOut`
- Timer: `PomodoroStart`, `PomodoroProgress`, `PomodoroOut`
- Progress: `ProgressLogOut`, `DashboardOut`
- Notification: `NotificationOut`
- Admin: `AdminUserReport`

**Consumed by:** All routers for request validation and response serialization.

---

## 6. AI Agent System (`agents/`)

### `agents/orchestrator.py` — The Brain

**Purpose:** Multi-agent orchestration using AutoGen 0.4 framework.

**Key components:**
1. **LLM Client Factory** — `_get_openrouter_client()`, `_get_gemini_client()`, `_get_openai_client()`, `_get_groq_client()` — all route through OpenRouter
2. **System Prompts** — detailed persona prompts for each agent
3. **Agent Builder** — `build_agents()` creates 10 specialized `AssistantAgent` instances
4. **Tool Binding** — `get_agent_tools()` wraps `agents/tools.py` functions as `FunctionTool` objects mapped to specific agents
5. **Intent Detection** — `detect_intent()` pattern-matches user messages to route to the correct agent
6. **Message Processing** — `process_message()` is the main entry point called by `chat_router.py`
7. **Streaming** — `process_message_stream()` provides SSE streaming responses

**Agent → LLM Model mapping:**
| Agent | LLM Provider |
|-------|-------------|
| InstructorAI, TeachingAgent, AssignmentEvaluator | GPT-4o-mini via OpenRouter |
| AssessmentAgent, RoadmapAgent, ProgressTracker, Pomodoro, Reminder, Performance, Admin | Gemini 2.0 Flash via OpenRouter |

**Data flow:**
```
chat_router.py → process_message() → detect_intent() → build_agents() + get_agent_tools() → agent.run() → tools.py functions → DB
```

### `agents/tools.py` — Database Action Layer

All functions that agents can invoke:
- `save_assessment()` — updates UserProfile
- `create_learning_session()` — creates LearningSession + LearningSteps, resolves YouTube/doc links via `utils/search_helpers.py`, saves JSON backup to `uploads/modules/`
- `get_session_roadmap()` / `get_active_learning_session()` — query helpers
- `mark_step_complete()` — marks step done → updates session → triggers `generate_tasks_for_step()` → updates `ProgressLog` → clears old notifications
- `generate_tasks_for_step()` — creates Assignment records (uses LLM fallback via direct OpenAI client for task generation)
- `update_progress_log()` — upserts daily ProgressLog
- `score_assignment()` — stores evaluation results
- `check_gating_status()` — soft gate logic
- `log_pomodoro_complete()` / `update_live_focus_time()` — timer DB ops
- `send_notification()` — creates Notification records
- `get_user_stats()` — aggregated metrics
- `save_chat_message()` — persists chat messages with retry logic for SQLite locks
- `get_exact_resources()` — fetches YouTube/doc links via `utils/search_helpers.py`

---

## 7. API Routers (`routers/`)

### `auth_router.py` (`/api/auth/`)
- Signup, login, Google OAuth (popup + redirect flow), logout, password reset
- **Calls:** `auth/service.py`, `db/models.py`, `agents/tools.send_notification()`

### `chat_router.py` (`/api/chat/`)
- Chat sessions CRUD, message send (sync + streaming), history, cleanup
- **Calls:** `agents/orchestrator.process_message()` / `process_message_stream()`, `db/models.py`

### `assignment_router.py` (`/api/tasks/`)
- Text + file submission, AI evaluation, assignment list, delete
- **Calls:** `agents/orchestrator.build_agents()` + `_safe_run_agent()` for evaluation, `agents/tools.update_progress_log()`, `files/processor.py`

### `progress_router.py` (`/api/progress/`)
- Dashboard aggregation, session list/delete, roadmap generation, step toggle/activate
- **Calls:** `agents/orchestrator.process_message()` (for roadmap), `agents/tools.mark_step_complete()` / `generate_tasks_for_step()`, `utils/date_helpers.py`

### `timer_router.py` (`/api/timer/`)
- Start/stop/progress/history for Pomodoro sessions
- **Calls:** `agents/tools.log_pomodoro_complete()` / `update_live_focus_time()`

### `notification_router.py` (`/api/notifications/`)
- List, mark read, mark all read, test notification, EOD summary
- **Calls:** `agents/tools.send_notification()`, `db/models.py`

### `admin_router.py` (`/api/admin/`)
- User reports, platform stats (admin-only)
- **Calls:** `auth/dependencies.require_admin()`, `db/models.py`

### `export_router.py` (`/api/export/`)
- Export roadmaps as PDF (ReportLab) or DOCX (python-docx)
- **Calls:** `db/models.py`

---

## 8. Utilities (`utils/`)

### `utils/search_helpers.py`
- `fetch_exact_youtube_link()` — DuckDuckGo video search for exact YouTube URLs
- `fetch_exact_doc_link()` — DuckDuckGo text search for documentation URLs
- **Called by:** `agents/tools.py` (during roadmap creation and `get_exact_resources`)

### `utils/date_helpers.py`
- `is_holiday_or_sunday()` — checks against Indian national holidays
- `get_next_working_day()` / `shift_dates_forward()` — working day calculations
- **Called by:** `scheduler.py` (rescheduling missed steps), `progress_router.py` (auto-reschedule)

---

## 9. File Processing (`files/processor.py`)

- Extracts text from uploaded files: PDF (PyPDF2), DOCX (python-docx), code files (raw read)
- **Called by:** `assignment_router.py` (file submissions)

---

## 10. Background Scheduler (`scheduler.py`)

Uses APScheduler with 3 cron jobs:
1. **Morning Plan** (configurable hour) — sends daily topic summary notification to all users
2. **EOD Reminder** (configurable hour) — checks missed goals → reschedules incomplete steps → sends recap
3. **Weekly Report** (Sunday 8 PM) — weekly performance summary

**Calls:** `agents/tools.send_notification()`, `utils/date_helpers.shift_dates_forward()`, `db/models.py`

---

## 11. LLM Client Factory (`api/llm_client.py`)

- Centralized `LLMClientFactory.create_client()` using AutoGen's `OpenAIChatCompletionClient`
- Routes through OpenRouter by default
- **Note:** The orchestrator has its own inline client factories (`_get_openrouter_client`, etc.) that duplicate this logic for tighter control.
