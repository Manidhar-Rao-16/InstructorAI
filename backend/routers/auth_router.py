"""
Auth router: signup, login, get current user, and password reset.
Email verification is disabled — valid email format is sufficient to register.
"""
from fastapi import APIRouter, Depends, HTTPException, status, Request
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import secrets
import httpx
import json
import base64
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode, urlparse

from db.database import get_db
from db.models import User, UserProfile
from schemas.schemas import UserCreate, UserLogin, Token, UserOut
from auth.service import hash_password, verify_password, create_access_token
from auth.dependencies import get_current_user
from config import settings
from google.oauth2 import id_token
from google.auth.transport import requests
from schemas.schemas import GoogleLoginRequest

# In-memory store for reset tokens: {token: {"user_id": int, "expires_at": datetime}}
_reset_tokens: dict[str, dict] = {}

router = APIRouter(prefix="/auth", tags=["Authentication"])


@router.post("/signup", response_model=Token, status_code=status.HTTP_201_CREATED)
async def signup(payload: UserCreate, db: AsyncSession = Depends(get_db)):
    # Check if email already taken
    result = await db.execute(select(User).where(User.email == payload.email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Email already registered")

    # Validate role
    role = payload.role if payload.role in ("user", "admin") else "user"

    user = User(
        email=payload.email,
        hashed_password=hash_password(payload.password),
        role=role,
        is_verified=True,           # no email verification required
        verification_token=None,
    )
    db.add(user)
    await db.flush()  # get user.id

    profile = UserProfile(
        user_id=user.id,
        display_name=payload.display_name or payload.email.split("@")[0],
    )
    db.add(profile)
    await db.commit()
    await db.refresh(user)
    await db.refresh(profile)

    token = create_access_token({"sub": str(user.id), "role": user.role.value})

    # Send Welcome Notification
    from agents.tools import send_notification
    await send_notification(
        db, user.id,
        notif_type="general",
        title="Welcome to InstructorAI! 🚀",
        message=f"Hi {profile.display_name}, we're thrilled to have you here! Head over to the Planner to start your first roadmap."
    )

    return Token(
        access_token=token,
        role=user.role.value,
        user_id=user.id,
        display_name=profile.display_name,
    )


@router.post("/login", response_model=Token)
async def login(payload: UserLogin, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(User).where(User.email == payload.email))
    user = result.scalar_one_or_none()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Account is deactivated")

    # Load profile for display name
    prof_result = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    profile = prof_result.scalar_one_or_none()

    # Send Welcome Back Notification
    from agents.tools import send_notification
    print(f"DEBUG: Triggering welcome notification for user {user.id}")
    try:
        await send_notification(
            db, user.id,
            notif_type="general",
            title="Welcome back! 👋",
            message="Ready to continue your learning journey? Check your dashboard for today's tasks."
        )
        print(f"DEBUG: Successfully sent welcome notification for user {user.id}")
    except Exception as e:
        print(f"DEBUG_ERROR: Failed to send notification for user {user.id}: {e}")

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return Token(
        access_token=token,
        role=user.role.value,
        user_id=user.id,
        display_name=profile.display_name if profile else None,
    )


@router.post("/google", response_model=Token)
async def google_login(payload: GoogleLoginRequest, db: AsyncSession = Depends(get_db)):
    """
    Verifies Google ID Token (popup flow — works from localhost only).
    If user doesn't exist, create account. If user exists, log them in.
    """
    if not settings.google_client_id:
        print("WARNING: GOOGLE_CLIENT_ID not set in .env. Skipping verification for testing.")
        if payload.id_token == "test-token":
             idinfo = {"email": "testuser@gmail.com", "sub": "12345", "name": "Test User"}
        else:
            raise HTTPException(status_code=500, detail="Google Auth not configured")
    else:
        try:
            print(f"DEBUG: Verifying Google token with client_id: {settings.google_client_id[:20]}...")
            idinfo = id_token.verify_oauth2_token(
                payload.id_token, requests.Request(), settings.google_client_id
            )
            print(f"DEBUG: Google token verified for email: {idinfo.get('email')}")
        except ValueError as e:
            print(f"DEBUG_ERROR: Google token verification failed: {e}")
            raise HTTPException(status_code=401, detail=f"Invalid Google token: {str(e)}")
        except Exception as e:
            print(f"DEBUG_ERROR: Unexpected error during Google auth: {type(e).__name__}: {e}")
            raise HTTPException(status_code=500, detail=f"Google authentication error: {str(e)}")

    email = idinfo["email"].lower()
    google_id = idinfo["sub"]
    name = idinfo.get("name") or email.split("@")[0]

    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()

    if not user:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            user.google_id = google_id
            await db.commit()
        else:
            user = User(
                email=email, google_id=google_id,
                hashed_password=None, role=payload.role, is_verified=True
            )
            db.add(user)
            await db.flush()
            profile = UserProfile(user_id=user.id, display_name=name)
            db.add(profile)
            await db.commit()
            from agents.tools import send_notification
            await send_notification(
                db, user.id, notif_type="general",
                title="Welcome to InstructorAI! 🚀",
                message=f"Hi {name}, you've successfully signed up with Google! Head over to the Planner to start."
            )

    prof_result = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    profile = prof_result.scalar_one_or_none()

    token = create_access_token({"sub": str(user.id), "role": user.role.value})
    return Token(
        access_token=token,
        role=user.role.value,
        user_id=user.id,
        display_name=profile.display_name if profile else name
    )


# ─── Server-Side Google OAuth Redirect Flow ──────────────────────────────────
# This flow works from ANY frontend origin (localhost, 192.168.x.x, etc.)
# because Google never checks the JavaScript origin — only the redirect_uri.

# IMPORTANT: This redirect_uri MUST be registered in Google Cloud Console.
# Go to: https://console.cloud.google.com/apis/credentials
# Add this EXACT URI under "Authorized redirect URIs":
GOOGLE_REDIRECT_URI = "http://localhost:8000/api/auth/google/callback"


@router.get("/google/redirect")
async def google_redirect(request: Request, role: str = "user", frontend_origin: str = ""):
    """
    Step 1: Redirect to Google's consent screen.
    The frontend calls this endpoint. We capture the frontend's real origin
    (e.g. http://192.168.0.11:5173) and encode it in the 'state' param.
    We always use GOOGLE_REDIRECT_URI (localhost:8000) as the redirect_uri.
    """
    if not settings.google_client_id or not settings.google_client_secret:
        raise HTTPException(status_code=500, detail="Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env")

    # Get the frontend origin so the callback knows where to redirect back to
    origin = frontend_origin or ""
    if not origin:
        referer = request.headers.get("referer", "")
        if referer:
            parsed = urlparse(referer)
            origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.netloc else ""
    if not origin:
        origin = settings.frontend_url

    # Encode role + frontend origin in the state param
    state_data = json.dumps({"role": role, "frontend": origin})
    state = base64.urlsafe_b64encode(state_data.encode()).decode()

    params = {
        "client_id": settings.google_client_id,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": "openid email profile",
        "access_type": "offline",
        "prompt": "select_account",
        "state": state,
    }
    google_url = f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"
    print(f"DEBUG: Google OAuth redirect, frontend_origin={origin}")
    return RedirectResponse(google_url)


@router.get("/google/callback")
async def google_callback(
    request: Request,
    code: str = None,
    state: str = "",
    error: str = None,
    db: AsyncSession = Depends(get_db),
):
    """
    Step 2: Google redirects here with an auth code.
    We exchange the code for tokens, find/create the user,
    then redirect back to the ORIGINAL frontend URL with JWT data.
    """
    # Decode state to recover the frontend origin
    frontend_url = settings.frontend_url
    role = "user"
    try:
        # Add padding for base64 decoding
        padded = state + "=" * (4 - len(state) % 4)
        state_data = json.loads(base64.urlsafe_b64decode(padded))
        role = state_data.get("role", "user")
        frontend_url = state_data.get("frontend", settings.frontend_url)
    except Exception as e:
        print(f"DEBUG: Could not decode state param: {e}")

    if error:
        print(f"DEBUG_ERROR: Google returned error: {error}")
        return RedirectResponse(f"{frontend_url}/?google_error={error}")

    if not code:
        return RedirectResponse(f"{frontend_url}/?google_error=no_code")

    # Exchange authorization code for tokens
    async with httpx.AsyncClient() as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )

    token_data = token_response.json()
    if "error" in token_data:
        print(f"DEBUG_ERROR: Token exchange failed: {token_data}")
        return RedirectResponse(f"{frontend_url}/?google_error=token_exchange_failed")

    google_id_token = token_data.get("id_token")
    if not google_id_token:
        return RedirectResponse(f"{frontend_url}/?google_error=no_id_token")

    # Verify the ID token
    try:
        idinfo = id_token.verify_oauth2_token(
            google_id_token, requests.Request(), settings.google_client_id
        )
    except ValueError as e:
        print(f"DEBUG_ERROR: Token verification failed: {e}")
        return RedirectResponse(f"{frontend_url}/?google_error=invalid_token")

    email = idinfo["email"].lower()
    google_id = idinfo["sub"]
    name = idinfo.get("name") or email.split("@")[0]
    role = role if role in ("user", "admin") else "user"

    # Find or create user
    result = await db.execute(select(User).where(User.google_id == google_id))
    user = result.scalar_one_or_none()

    if not user:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user:
            user.google_id = google_id
            await db.commit()
        else:
            user = User(
                email=email, google_id=google_id,
                hashed_password=None, role=role, is_verified=True
            )
            db.add(user)
            await db.flush()
            profile = UserProfile(user_id=user.id, display_name=name)
            db.add(profile)
            await db.commit()
            from agents.tools import send_notification
            await send_notification(
                db, user.id, notif_type="general",
                title="Welcome to InstructorAI! 🚀",
                message=f"Hi {name}, you've successfully signed up with Google!"
            )

    prof_result = await db.execute(select(UserProfile).where(UserProfile.user_id == user.id))
    profile = prof_result.scalar_one_or_none()
    display_name = profile.display_name if profile else name

    jwt_token = create_access_token({"sub": str(user.id), "role": user.role.value})

    # Build base64-encoded payload and redirect to the original frontend
    payload = base64.urlsafe_b64encode(json.dumps({
        "access_token": jwt_token,
        "role": user.role.value,
        "user_id": user.id,
        "display_name": display_name,
        "email": email,
    }).encode()).decode()

    print(f"DEBUG: Google OAuth success for {email}, redirecting to {frontend_url}")
    return RedirectResponse(f"{frontend_url}/?google_auth={payload}")


@router.get("/me", response_model=UserOut)
async def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/logout-notify")
async def logout_notify(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Send a notification summarizing pending tasks before logout."""
    from agents.tools import send_notification
    from db.models import Assignment, LearningSession
    pending_res = await db.execute(
        select(Assignment).where(Assignment.user_id == current_user.id, Assignment.status == "pending")
    )
    pending_count = len(pending_res.scalars().all())
    active_sess_res = await db.execute(
        select(LearningSession).where(LearningSession.user_id == current_user.id, LearningSession.status == "in_progress")
    )
    active_sessions = active_sess_res.scalars().all()
    topic_names = ", ".join(s.topic for s in active_sessions[:3]) if active_sessions else "none"
    message = f"See you soon! You have {pending_count} pending task(s) waiting. Active topics: {topic_names}. Keep going — consistency is the key to mastery! 🔥"
    await send_notification(db, current_user.id, notif_type="general", title="Until next time! 👋", message=message)
    return {"status": "ok"}


# ─── Password Reset ──────────────────────────────────────────────────────────

@router.post("/forgot-password")
async def forgot_password(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """Step 1: Validate email and issue a short-lived reset token."""
    email = payload.get("email", "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="Email is required")

    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if not user:
        return {"detail": "If that email is registered, a reset token has been issued."}

    expired_keys = [k for k, v in _reset_tokens.items() if v["user_id"] == user.id]
    for k in expired_keys:
        _reset_tokens.pop(k, None)

    token = secrets.token_urlsafe(32)
    _reset_tokens[token] = {
        "user_id": user.id,
        "expires_at": datetime.now(timezone.utc) + timedelta(minutes=15),
    }

    return {
        "detail": "Reset token issued. Enter it below to set your new password.",
        "reset_token": token,
    }


@router.post("/reset-password")
async def reset_password(
    payload: dict,
    db: AsyncSession = Depends(get_db),
):
    """Step 2: Validate the reset token and update the password."""
    token = payload.get("token", "").strip()
    new_password = payload.get("new_password", "").strip()

    if not token:
        raise HTTPException(status_code=400, detail="Reset token is required")
    if len(new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    entry = _reset_tokens.get(token)
    if not entry:
        raise HTTPException(status_code=400, detail="Invalid or expired reset token")

    if datetime.now(timezone.utc) > entry["expires_at"]:
        _reset_tokens.pop(token, None)
        raise HTTPException(status_code=400, detail="Reset token has expired. Please request a new one.")

    user = await db.get(User, entry["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.hashed_password = hash_password(new_password)
    await db.commit()
    _reset_tokens.pop(token, None)

    return {"detail": "Password updated successfully. You can now sign in."}
