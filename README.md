# InstructorAI — Full Stack Project

AI-powered personalized learning platform with multi-agent orchestration.

## Project Structure

```
instructorai_project/
├── backend/                    # FastAPI Python backend
│   ├── main.py                 # App entry point, CORS, middleware
│   ├── config.py               # Settings (reads .env)
│   ├── requirements.txt        # Python dependencies
│   ├── .env.example            # Copy to .env and fill in keys
│   ├── start-backend.sh        # Quick start script
│   ├── migrate_db.py           # Database migration helper
│   ├── scheduler.py            # Background job scheduler
│   ├── agents/
│   │   ├── orchestrator.py     # Multi-agent routing & AI logic
│   │   └── tools.py            # Agent tool functions (DB ops)
│   ├── auth/
│   │   ├── dependencies.py     # JWT auth dependency
│   │   └── service.py          # Password hashing, JWT creation
│   ├── db/
│   │   ├── database.py         # Async SQLAlchemy engine
│   │   └── models.py           # ORM models
│   ├── routers/
│   │   ├── auth_router.py      # /api/auth/* (login, signup, Google, logout-notify)
│   │   ├── chat_router.py      # /api/chat/* (messages, sessions)
│   │   ├── progress_router.py  # /api/progress/* (dashboard, roadmap, steps)
│   │   ├── assignment_router.py# /api/tasks/* (submit, list, delete)
│   │   ├── notification_router.py # /api/notifications/* (list, read, end-of-day)
│   │   ├── timer_router.py     # /api/timer/* (pomodoro sessions)
│   │   ├── export_router.py    # /api/export/* (PDF, DOCX)
│   │   └── admin_router.py     # /api/admin/* (admin reports)
│   └── schemas/
│       └── schemas.py          # Pydantic request/response models
│
└── frontend/                   # React + Vite frontend
    ├── package.json
    ├── vite.config.js
    ├── .env.example             # Copy to .env and fill in keys
    ├── index.html
    ├── public/
    │   ├── logo.png
    │   └── favicon.ico
    └── src/
        ├── App.jsx              # Router, layout, protected routes
        ├── main.jsx             # React entry point
        ├── index.css            # Global styles & design tokens
        ├── services/
        │   └── api.js           # Axios API client (all endpoints)
        ├── contexts/
        │   ├── AuthContext.jsx  # User auth state (login/signup/logout)
        │   ├── ChatContext.jsx  # Chat sessions state
        │   ├── TimerContext.jsx # Pomodoro timer global state
        │   └── ThemeContext.jsx # Dark/light theme
        ├── components/
        │   ├── Navbar.jsx       # Top nav, user profile dropdown, notifications
        │   ├── Sidebar.jsx      # Chat history sidebar (date-grouped)
        │   ├── AuthModal.jsx    # Login/Signup/Forgot Password modal
        │   └── NotificationPanel.jsx # Notifications dropdown
        └── pages/
            ├── Home.jsx         # Landing page (public)
            ├── Dashboard.jsx    # Main dashboard with stats
            ├── Planner.jsx      # Roadmap generator + daily modules
            ├── Chat.jsx         # InstructorAI chatbot + lesson panel
            ├── Tasks.jsx        # Assignments (pending + graded)
            ├── Timer.jsx        # Pomodoro focus timer
            ├── Progress.jsx     # Analytics & progress charts
            └── Admin.jsx        # Admin user management
```

## Quick Start

### Backend

```bash
cd backend

# 1. Create virtual environment
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure environment
cp .env.example .env
# Edit .env and add your API keys (GEMINI_API_KEY is required at minimum)

# 4. Start the server
python main.py
# OR use the script:
bash start-backend.sh
```

Backend runs at: http://localhost:8000  
API docs: http://localhost:8000/api/docs

### Frontend

```bash
cd frontend

# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# VITE_API_URL defaults to http://localhost:8000/api

# 3. Start dev server
npm run dev
```

Frontend runs at: http://localhost:5173

## Features

| Feature | Description |
|---|---|
| 🏠 Landing Page | Public intro page with Sign In / Get Started |
| 🔐 Auth | Email/password + Google OAuth, forgot password flow |
| 📊 Dashboard | Stats: Total Topics, Mastered, Completion %, Avg Score, Focus Time |
| 🗺️ Planner | AI roadmap generator with proficiency levels, holiday skip (Sundays) |
| 🤖 InstructorAI Chat | Multi-agent chatbot with chat history grouped by date |
| 📝 Tasks | Auto-generated assignments per chapter, AI evaluation with scores |
| ⏱️ Focus Timer | 30-min Pomodoro with break management |
| 📈 Progress | Charts: focus time, chapters/day, active & completed roadmaps |
| 🔔 Notifications | Popup toasts + panel: login, task added, EOD summary, logout |
| 👤 User Profile | Dropdown with name, email, role, and sign-out |

## API Keys Required

- **GEMINI_API_KEY** — Required (roadmap generation fallback)
- **OPENAI_API_KEY** — Recommended (teaching agent, assignment evaluation)
- **GROQ_API_KEY** — Optional (faster roadmap generation)
- **GOOGLE_CLIENT_ID** — Optional (for Google Sign-In button)
