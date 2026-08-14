from functools import lru_cache
from typing import List

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        protected_namespaces=(),
    )

    app_name: str = "AI Job Application Assistant"
    environment: str = "development"

    database_url: str = "sqlite:///./app.db"

    storage_backend: str = "local"
    local_storage_path: str = "./data/resumes"
    output_dir: str = "./data/output"
    max_upload_size_mb: int = 10
    allowed_extensions: str = "pdf,doc,docx,tex"

    test_username: str = "testuser"
    test_password: str = "testpass"
    test_token: str = "test-token"

    # Per-task model routing: `provider:model`. Empty override uses the default.
    llm_default: str = "gemini:gemini-1.5-flash"
    llm_jd_extraction: str = ""
    llm_resume_tailor: str = "gemini:gemini-1.5-pro"
    llm_bullet_rewrite: str = ""
    llm_cover_letter: str = ""
    embedding_default: str = "gemini:text-embedding-004"
    embedding_requirement: str = ""
    embedding_resume: str = ""

    # Per-provider credentials — only required when a spec actually selects that provider.
    google_ai_api_key: str = "placeholder-api-key-replace-with-real"
    openai_api_key: str = ""
    ollama_base_url: str = "http://localhost:11434"

    # Kept for older env files; unused by the gateway (use llm_default instead).
    gemini_model: str = "gemini-1.5-flash"

    model_max_retries: int = 2
    model_timeout_seconds: float = 60.0

    semantic_threshold: float = 0.72
    must_have_weight: float = 1.0
    nice_to_have_weight: float = 0.4
    tier2_confidence_factor: float = 0.85

    latex_compiler: str = "tectonic"
    scraper_provider: str = "noop"

    @property
    def allowed_extensions_list(self) -> List[str]:
        return [ext.strip().lower() for ext in self.allowed_extensions.split(",") if ext.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
