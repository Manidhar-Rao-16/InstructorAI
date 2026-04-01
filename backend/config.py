"""
Application Configuration
------------------------
Defines the Settings class using pydantic-settings to manage environment variables 
and default configurations. Reads from a .env file if available.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, AliasChoices
import os


class Settings(BaseSettings):
    """
    Centralized configuration for the InstructorAI backend.
    Includes database URLs, API keys, security settings, and file paths.
    """
    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

    # --- Multi-LLM Provider Settings ---
    llm_api_key: str = Field(default="", validation_alias=AliasChoices("OPENROUTER_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY", "llm_api_key"))
    
    openrouter_api_key: str = Field(default="", validation_alias=AliasChoices("OPENROUTER_API_KEY", "openrouter_api_key"))
    openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1", validation_alias=AliasChoices("OPENROUTER_BASE_URL", "openrouter_base_url"))

    openai_api_key: str = Field(default="", validation_alias=AliasChoices("OPENAI_API_KEY", "openai_api_key"))
    openai_base_url: str = Field(default="https://api.openai.com/v1", validation_alias=AliasChoices("OPENAI_BASE_URL", "openai_base_url"))
    
    gemini_api_key: str = Field(default="", validation_alias=AliasChoices("GEMINI_API_KEY", "gemini_api_key"))
    gemini_base_url: str = Field(default="https://generativelanguage.googleapis.com/v1beta/openai", validation_alias=AliasChoices("GEMINI_BASE_URL", "gemini_base_url"))

    groq_api_key: str = Field(default="", validation_alias=AliasChoices("GROQ_API_KEY", "groq_api_key"))
    groq_base_url: str = Field(default="https://api.groq.com/openai/v1", validation_alias=AliasChoices("GROQ_BASE_URL", "groq_base_url"))

    llm_model: str = Field(default="google/gemini-2.0-flash-001", validation_alias=AliasChoices("LLM_MODEL", "llm_model"))
    llm_base_url: str = Field(default="https://openrouter.ai/api/v1", validation_alias=AliasChoices("LLM_BASE_URL", "llm_base_url"))

    # --- Server Connectivity & Security ---
    app_env: str = Field(default="development", validation_alias=AliasChoices("APP_ENV", "app_env"))
    app_host: str = Field(default="0.0.0.0", validation_alias=AliasChoices("APP_HOST", "app_host"))
    app_port: int = Field(default=8000, validation_alias=AliasChoices("APP_PORT", "app_port"))
    
    # JWT & Auth
    secret_key: str = Field(default="super-secret-key", validation_alias=AliasChoices("SECRET_KEY", "secret_key"))
    jwt_algorithm: str = Field(default="HS256", validation_alias=AliasChoices("JWT_ALGORITHM", "jwt_algorithm"))
    jwt_expire_minutes: int = Field(default=1440, validation_alias=AliasChoices("JWT_EXPIRE_MINUTES", "jwt_expire_minutes"))
    google_client_id: str = Field(default="", validation_alias=AliasChoices("GOOGLE_CLIENT_ID", "google_client_id"))
    google_client_secret: str = Field(default="", validation_alias=AliasChoices("GOOGLE_CLIENT_SECRET", "google_client_secret"))

    # --- Database Persistence ---
    # Use absolute path for SQLite to avoid issues when running from different directories
    database_url: str = Field(
        default=f"sqlite+aiosqlite:///{os.path.abspath(os.path.join(os.path.dirname(__file__), 'instructorai.db'))}", 
        validation_alias=AliasChoices("DATABASE_URL", "database_url")
    )

    # --- Storage & File Management ---
    # Locations for user-uploaded files and auto-generated learning modules
    upload_dir: str = Field(default="./uploads", validation_alias=AliasChoices("UPLOAD_DIR", "upload_dir"))
    modules_dir: str = Field(default="./uploads/modules", validation_alias=AliasChoices("MODULES_DIR", "modules_dir"))
    max_file_size_mb: int = Field(default=20, validation_alias=AliasChoices("MAX_FILE_SIZE_MB", "max_file_size_mb"))

    # --- Cross-Origin Resource Sharing (CORS) ---
    frontend_url: str = Field(default="http://localhost:5173", validation_alias=AliasChoices("FRONTEND_URL", "frontend_url"))

    # --- Communication (Email / SMTP) ---
    mail_server: str = Field(default="smtp.gmail.com", validation_alias=AliasChoices("MAIL_SERVER", "mail_server"))
    mail_port: int = Field(default=587, validation_alias=AliasChoices("MAIL_PORT", "mail_port"))
    mail_username: str = Field(default="", validation_alias=AliasChoices("MAIL_USERNAME", "mail_username"))
    mail_password: str = Field(default="", validation_alias=AliasChoices("MAIL_PASSWORD", "mail_password"))
    mail_from: str = Field(default="", validation_alias=AliasChoices("MAIL_FROM", "mail_from"))
    mail_use_tls: bool = Field(default=True, validation_alias=AliasChoices("MAIL_USE_TLS", "mail_use_tls"))

    # --- Scheduled Background Jobs ---
    morning_job_hour: int = Field(default=7, validation_alias=AliasChoices("MORNING_JOB_HOUR", "morning_job_hour"))
    morning_job_minute: int = Field(default=0, validation_alias=AliasChoices("MORNING_JOB_MINUTE", "morning_job_minute"))
    eod_job_hour: int = Field(default=21, validation_alias=AliasChoices("EOD_JOB_HOUR", "eod_job_hour"))
    eod_job_minute: int = Field(default=0, validation_alias=AliasChoices("EOD_JOB_MINUTE", "eod_job_minute"))

    # --- Default Administrative Credentials ---
    admin_email: str = Field(default="admin@instructorai.com", validation_alias=AliasChoices("ADMIN_EMAIL", "admin_email"))
    admin_password: str = Field(default="Admin@1234!", validation_alias=AliasChoices("ADMIN_PASSWORD", "admin_password"))


# Global settings instance to be imported elsewhere
settings = Settings()
