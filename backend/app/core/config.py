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
    # Where a finalized resume is filed for real use: one folder per resume family.
    resume_library_root: str = "./data/library"
    max_upload_size_mb: int = 10
    allowed_extensions: str = "pdf,doc,docx,tex"

    test_username: str = "testuser"
    test_password: str = "testpass"
    test_token: str = "test-token"

    # Per-task model routing: `provider:model`. Empty override uses the default.
    llm_default: str = "gemini:gemini-3.8-flash"
    llm_jd_extraction: str = ""
    llm_resume_tailor: str = "chatgpt:gpt-6.1-sol"
    llm_bullet_rewrite: str = ""
    llm_cover_letter: str = "chatgpt:gpt-6.1-sol"
    embedding_default: str = "gemini:gemini-embedding-001"
    embedding_requirement: str = ""
    embedding_resume: str = ""

    # Per-provider credentials — only required when a spec actually selects that provider.
    google_ai_api_key: str = "placeholder-api-key-replace-with-real"
    openai_api_key: str = ""
    # Local, single-user ChatGPT OAuth credentials; separate from API-key billing.
    chatgpt_auth_file: str = "./data/chatgpt-auth.json"
    nvidia_api_key: str = ""
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"
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
    # auto/soffice use LibreOffice; word drives Word over AppleScript; off skips PDF.
    docx_pdf_converter: str = "auto"
    scraper_provider: str = "public"
    agent_worker_enabled: bool = True
    serpapi_api_key: str = ""
    discovery_max_pages: int = 3
    discovery_max_results: int = 250

    @property
    def allowed_extensions_list(self) -> List[str]:
        return [ext.strip().lower() for ext in self.allowed_extensions.split(",") if ext.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
