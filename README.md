# 🎓 InstructorAI — AI-Powered Personalized Learning

InstructorAI is a sophisticated, full-stack learning platform that leverages **Multi-Agent Orchestration** to provide a personalized, adaptive educational experience. It automates curriculum generation, provides real-time mentoring, and evaluates progress through an intelligent task system.

---

## 🚀 Key Features

| Feature | Description |
|:---|:---|
| **🗺️ Smart Planner** | Generates tailored roadmaps based on goals and proficiency. Features holiday management (automatic Sunday skips) and logical module sequencing. |
| **🤖 Multi-Agent Chat** | Powered by **Microsoft AutoGen**. A specialized teaching agent provides context-aware guidance and maintains session history. |
| **📝 AI Task System** | Dynamically creates assignments for every chapter. Submissions are graded by an AI Evaluator with detailed feedback. |
| **📊 Analytics Dashboard** | Real-time monitoring of total topics, mastery levels, completion percentages, and average performance scores. |
| **⏱️ Focus Timer** | Built-in Pomodoro timer (30-min sessions) with break management to optimize deep work. |
| **📈 Progress Visuals** | Rich data visualization showing active roadmaps, chapters completed per day, and daily focus trends. |
| **🔔 Smart Notifications** | Real-time toasts and persistent notifications for tasks, system status, and end-of-day summaries. |
| **🔐 Secure Auth** | Email/Password and Google OAuth integration for a seamless onboarding experience. |

---

## 🛠️ Technology Stack

### Backend (Python)
- **Framework:** FastAPI (High performance, async)
- **AI Orchestration:** Microsoft AutoGen (0.4+)
- **Integrated Provider:** OpenRouter (Recommended for all agents)
- **Fallback Models:** OpenAI GPT-4o, Google Gemini 1.5, Groq
- **Database:** SQLite with SQLAlchemy (Async engine)
- **Migrations:** Alembic
- **Task Scheduling:** APScheduler
- **Exports:** ReportLab (PDF), python-docx (DOCX)

### Frontend (React)
- **Framework:** React 19 + Vite
- **State Management:** React Context API
- **Charts:** Recharts
- **Styling:** Vanilla CSS (Modern design tokens)
- **Icons:** Lucide React
- **UI Components:** SweetAlert2, React Dropzone, Markdown Rendering
- **Diagrams:** Mermaid.js

---

## 📂 Project Structure

```text
instructorai/
├── backend/                    # FastAPI Server
│   ├── main.py                 # Application Entry Point
│   ├── agents/                 # AutoGen Multi-Agent Logic
│   ├── api/                    # Core LLM Clients
│   ├── auth/                   # JWT & OAuth Services
│   ├── db/                     # Models & Database Logic
│   ├── routers/                # API Endpoints (Auth, Chat, Progress, etc.)
│   └── schemas/                # Pydantic Data Models
│
├── frontend/                   # Vite + React Client
│   ├── src/
│   │   ├── components/         # Reusable UI Blocks
│   │   ├── contexts/           # Global State Management
│   │   ├── pages/              # Main Route Components
│   │   └── services/           # Axios API Interface
│   └── public/                 # Static Assets
│
└── .gitignore                  # Optimized Git Configuration
```

---

## 🏁 Getting Started

### 1. Prerequisites
- Python 3.10+
- Node.js 18+
- API Keys (OpenAI, Gemini, or Groq)

### 2. Backend Setup
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Update .env with your API keys
python main.py
```

### 3. Frontend Setup
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

---

## 🗝️ Environment Configuration

### Backend `.env`
- `GEMINI_API_KEY`: Required for primary/fallback logic.
- `OPENAI_API_KEY`: Recommended for advanced evaluation.
- `DATABASE_URL`: Defaults to `sqlite+aiosqlite:///./instructorai.db`.
- `JWT_SECRET`: For session security.

### Frontend `.env`
- `VITE_API_URL`: Backend URL (Default: `http://localhost:8000/api`)
- `VITE_GOOGLE_CLIENT_ID`: Required for Google login features.

---

## 📜 License & Acknowledgments
Built with ❤️ using [FastAPI](https://fastapi.tiangolo.com/), [React](https://reactjs.org/), and [AutoGen](https://microsoft.github.io/autogen/).
