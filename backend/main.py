"""
Main FastAPI application entry point.
Initializes the application, configures middleware (CORS, Logging), 
registers api routers, and manages the application lifespan.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import datetime

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse

# Project-specific imports
from config import settings
from db.database import create_tables
from db.models import User, UserProfile
from auth.service import hash_password
from scheduler import start_scheduler

import logging

# Configure main application logger for debugging and audit
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("instructor_ai")

# ─── API Router Registration ──────────────────────────────────────────────────
# Modules are separated by functionality (auth, chat, assignments, etc.)
from routers.auth_router import router as auth_router
from routers.chat_router import router as chat_router
from routers.assignment_router import router as assignment_router # Now prefixed with /tasks
from routers.progress_router import router as progress_router
from routers.timer_router import router as timer_router
from routers.notification_router import router as notification_router
from routers.admin_router import router as admin_router
from routers.export_router import router as export_router


# ─── App Lifespan Management ─────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handles startup and shutdown logic for the FastAPI app.
    Startup: Creates DB tables, seeds admin user, starts background scheduler, 
    and ensures necessary directories exist.
    Shutdown: Safely stops the background scheduler.
    """
    # Startup Phase
    await create_tables()
    await _seed_admin()
    start_scheduler()
    
    # Ensure resource directories exist (for uploads and module storage)
    os.makedirs(settings.upload_dir, exist_ok=True)
    os.makedirs(settings.modules_dir, exist_ok=True)
    
    yield
    
    # Shutdown Phase
    from scheduler import scheduler
    if scheduler.running:
        scheduler.shutdown(wait=False)


async def _seed_admin():
    """
    Seeds a default admin user based on environment variables.
    If the admin exists but the password in .env has changed, it updates the password.
    """
    from db.database import AsyncSessionLocal
    from sqlalchemy import select
    from auth.service import verify_password
    
    async with AsyncSessionLocal() as db:
        admin_email = settings.admin_email.strip().lower()
        result = await db.execute(
            select(User).where(User.email == admin_email)
        )
        admin = result.scalar_one_or_none()
        
        # Create admin if it doesn't exist
        if not admin:
            admin = User(
                email=admin_email,
                hashed_password=hash_password(settings.admin_password),
                role="admin",
                is_verified=True,  # Admins created via seeding are pre-verified
            )
            db.add(admin)
            await db.flush() # Flush to get the user ID
            
            # Create a corresponding profile for the admin
            profile = UserProfile(
                user_id=admin.id,
                display_name="Platform Admin",
            )
            db.add(profile)
            await db.commit()
            print(f"[SEED] Admin created: {admin_email}")
        else:
            # Sync admin password with .env if it was changed manually in config
            if not verify_password(settings.admin_password, admin.hashed_password):
                admin.hashed_password = hash_password(settings.admin_password)
                await db.commit()
                print(f"[SEED] Admin password updated from .env configuration")


# ─── FastAPI Application Initialization ────────────────────────────────────────

app = FastAPI(
    title="InstructorAI — AI Personal Instructor Platform",
    description="Backend API for personal tutoring and focus management.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",    # Accessible Swagger UI
    redoc_url="/api/redoc",  # Alternate API documentation
)

# ─── Middleware ────────────────────────────────────────────────────────────────

@app.middleware("http")
async def log_requests(request, call_next):
    """
    Global middleware to log every incoming HTTP request and its response status.
    Also provides a failsafe error response for uncaught exceptions in the pipeline.
    """
    logger.info(f"Incoming: {request.method} {request.url}")
    try:
        response = await call_next(request)
        logger.info(f"Response: {response.status_code}")
        return response
    except Exception as e:
        import traceback
        error_msg = traceback.format_exc()
        logger.error(f"Request failed critically: {error_msg}")
        
        # Write to a file we can definitely read
        with open("error_trace.log", "a") as f:
            f.write(f"\n--- ERROR at {datetime.now()} ---\n")
            f.write(f"URL: {request.url}\n")
            f.write(error_msg)
            f.write("\n------------------------------\n")

        return JSONResponse(
            status_code=500,
            content={"status": "error", "detail": "Internal Server Error", "message": str(e), "trace": error_msg[:200]},
            headers={"Access-Control-Allow-Origin": "*"}
        )

# Catch-all exception handler for structured error reporting
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    """
    Handles any exceptions that bubble up to the app level.
    """
    logger.error(f"Global unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "An unexpected error occurred", "error": str(exc)}
    )

# Configure CORS (Cross-Origin Resource Sharing)
# Allows requests from local development environments (localhost, specific local IPs)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex="http://(localhost|127\\.0\\.0\\.1|192\\.168\\..*):.*", 
    allow_credentials=True,
    allow_methods=["*"],  # Allow all HTTP methods
    allow_headers=["*"],  # Allow all headers
    expose_headers=["*"],
)


# ─── Router Inclusion ─────────────────────────────────────────────────────────
# All routes are prefixed with /api
app.include_router(auth_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(assignment_router, prefix="/api")
app.include_router(progress_router, prefix="/api")
app.include_router(timer_router, prefix="/api")
app.include_router(notification_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(export_router, prefix="/api")


@app.get("/api/health")
async def health():
    """
    Simple health check endpoint to verify the API is running correctly.
    """
    return {"status": "ok", "service": "InstructorAI API", "version": "1.0.0"}
