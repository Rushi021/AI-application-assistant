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

    test_username: str = "testuser"
    test_password: str = "testpass"
    test_token: str = "test-token"

    @property
    def allowed_extensions_list(self) -> List[str]:
        return [ext.strip().lower() for ext in self.allowed_extensions.split(",") if ext.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
