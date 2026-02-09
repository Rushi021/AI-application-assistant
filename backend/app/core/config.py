from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "AI Job Application Assistant"
    environment: str = "development"

    database_url: str = "sqlite:///./app.db"

    storage_backend: str = "local"
    local_storage_path: str = "./data/resumes"
    max_upload_size_mb: int = 10
    allowed_extensions: str = "pdf,doc,docx"

    # Output paths for generated/tailored files saved to local machine
    output_resume_path: str = r"E:\rushi\storage - resume\resumes"
    output_cover_letter_path: str = r"E:\rushi\storage - resume\cover letters"

    # Legacy test auth (kept for backward compat; will be removed)
    test_username: str = "testuser"
    test_password: str = "testpass"
    test_token: str = "test-token"

    # Google OAuth
    google_oauth_client_id: str = ""

    # JWT settings
    jwt_secret_key: str = "change-me-in-production-use-a-long-random-string"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24  # 24 hours
    jwt_refresh_token_expire_minutes: int = 60 * 24 * 30  # 30 days

    # LLM (Gemini / Google AI) — use real key in env
    google_ai_api_key: str = "placeholder-api-key-replace-with-real"
    gemini_model: str = "gemini-1.5-flash"

    @property
    def allowed_extensions_list(self) -> List[str]:
        return [ext.strip().lower() for ext in self.allowed_extensions.split(",") if ext.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
