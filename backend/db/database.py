"""
SQLAlchemy async engine + session + base.
"""
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import event

from config import settings

# Convert sync SQLite URL to async if needed
DATABASE_URL = settings.database_url
if DATABASE_URL.startswith("sqlite:///") and "aiosqlite" not in DATABASE_URL:
    DATABASE_URL = DATABASE_URL.replace("sqlite:///", "sqlite+aiosqlite:///")

# SQLite connect_args: busy timeout prevents "database is locked" errors
# during concurrent reads/writes (e.g., streaming + history polling)
_sqlite_connect_args = {"check_same_thread": False, "timeout": 30} if "sqlite" in DATABASE_URL else {}

engine = create_async_engine(
    DATABASE_URL,
    echo=(settings.app_env == "development"),
    connect_args=_sqlite_connect_args,
    pool_pre_ping=True,
)

# Enable WAL (Write-Ahead Logging) mode for SQLite — allows concurrent
# readers while a writer is active (critical for streaming endpoints).
@event.listens_for(engine.sync_engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()

AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    """FastAPI dependency that provides an async DB session."""
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()


async def create_tables():
    """Create all tables on startup."""
    from db import models  # noqa: F401 — ensure models are registered
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
