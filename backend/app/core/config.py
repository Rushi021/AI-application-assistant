from functools import lru_cache
from typing import List, Optional

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    app_name: str = "AI Job Application Assistant"
    environment: str = Field(default="development", validation_alias=AliasChoices("ENVIRONMENT"))

    # Unsafe for production; production validator rejects this default.
    database_url: str = Field(
        default="sqlite:///./app.db",
        validation_alias=AliasChoices("DATABASE_URL"),
    )

    storage_backend: str = Field(default="local", validation_alias=AliasChoices("STORAGE_BACKEND"))
    local_storage_path: str = Field(
        default="./data/resumes",
        validation_alias=AliasChoices("LOCAL_STORAGE_PATH"),
    )
    allowed_origins: str = Field(default="", validation_alias=AliasChoices("ALLOWED_ORIGINS"))
    admin_emails: str = Field(default="", validation_alias=AliasChoices("ADMIN_EMAILS"))
    max_upload_size_mb: int = 10
    allowed_extensions: str = "pdf,doc,docx"

    aws_access_key_id: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("AWS_ACCESS_KEY_ID"),
    )
    aws_secret_access_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("AWS_SECRET_ACCESS_KEY"),
    )
    aws_endpoint_url: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("AWS_ENDPOINT_URL"),
    )
    s3_bucket_name: str = Field(
        default="resumes",
        validation_alias=AliasChoices("S3_BUCKET_NAME"),
    )
    api_key_encryption_key: Optional[str] = Field(
        default=None,
        validation_alias=AliasChoices("API_KEY_ENCRYPTION_KEY"),
    )

    # When True, also write generated .docx to these paths (dev / personal machine only).
    # Production + extension downloads should rely on HTTP responses, not server disk.
    persist_generated_files_to_disk: bool = Field(
        default=False,
        validation_alias=AliasChoices("PERSIST_GENERATED_FILES_TO_DISK"),
    )
    output_resume_path: str = r"E:\rushi\storage - resume\resumes"
    output_cover_letter_path: str = r"E:\rushi\storage - resume\cover letters"

    # Legacy test auth (kept for backward compat; will be removed)
    test_username: str = "testuser"
    test_password: str = "testpass"
    test_token: str = "test-token"

    # Unsafe for production; production validator rejects empty values.
    google_client_id: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_ID"),
    )
    google_client_secret: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_CLIENT_SECRET"),
    )
    google_web_redirect_uri: str = Field(
        default="http://localhost:8000/auth/web/google/callback",
        validation_alias=AliasChoices("GOOGLE_WEB_REDIRECT_URI"),
    )
    web_app_url: str = Field(
        default="http://localhost:8501",
        validation_alias=AliasChoices("WEB_APP_URL"),
    )
    web_login_code_ttl_seconds: int = Field(
        default=300,
        validation_alias=AliasChoices("WEB_LOGIN_CODE_TTL_SECONDS"),
    )

    # JWT settings
    # Unsafe for production; production validator rejects this default.
    secret_key: str = Field(
        default="local-dev-secret-do-not-use-in-production",
        validation_alias=AliasChoices("SECRET_KEY", "JWT_SECRET_KEY"),
    )
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24  # 24 hours
    jwt_refresh_token_expire_minutes: int = 60 * 24 * 30  # 30 days

    # LLM (Gemini / Google AI) — set GOOGLE_AI_API_KEY or GEMINI_API_KEY in env / .env
    google_ai_api_key: str = Field(
        default="placeholder-api-key-replace-with-real",
        validation_alias=AliasChoices("GOOGLE_AI_API_KEY", "GEMINI_API_KEY"),
    )
    gemini_model: str = Field(
        default="gemini-2.0-flash",
        validation_alias=AliasChoices("GEMINI_MODEL", "GOOGLE_GEMINI_MODEL"),
    )

    @property
    def allowed_extensions_list(self) -> List[str]:
        return [ext.strip().lower() for ext in self.allowed_extensions.split(",") if ext.strip()]

    @property
    def allowed_origins_list(self) -> List[str]:
        if self.allowed_origins.strip():
            return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]
        return ["http://localhost:3000", "http://localhost:5173"]

    @property
    def admin_emails_list(self) -> List[str]:
        return [email.strip().lower() for email in self.admin_emails.split(",") if email.strip()]

    def validate_startup_requirements(self) -> None:
        if self.environment != "production":
            return

        invalid: list[str] = []

        if not self.database_url.strip() or self.database_url == "sqlite:///./app.db":
            invalid.append("DATABASE_URL")

        if not self.secret_key.strip() or self.secret_key == "local-dev-secret-do-not-use-in-production":
            invalid.append("SECRET_KEY")

        if not self.google_client_id.strip():
            invalid.append("GOOGLE_CLIENT_ID")

        if not self.google_client_secret.strip():
            invalid.append("GOOGLE_CLIENT_SECRET")

        if invalid:
            raise RuntimeError(
                "Missing or insecure production configuration values: " + ", ".join(invalid)
            )


@lru_cache
def get_settings() -> Settings:
    return Settings()
