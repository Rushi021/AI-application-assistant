import hashlib
import os
import uuid

from app.common.ports import ResumeStorage
from app.core.config import get_settings


class LocalResumeStorage(ResumeStorage):
    def __init__(self) -> None:
        settings = get_settings()
        self._base_path = settings.local_storage_path
        os.makedirs(self._base_path, exist_ok=True)

    def save_file(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        file_id = f"{uuid.uuid4().hex}"
        extension = os.path.splitext(original_filename)[1].lower()
        filename = f"{file_id}{extension}"
        path = os.path.join(self._base_path, filename)
        with open(path, "wb") as handle:
            handle.write(file_bytes)
        return filename

    def get_file_url_or_path(self, file_key: str) -> str:
        return os.path.join(self._base_path, file_key)

    def delete_file(self, file_key: str) -> None:
        path = os.path.join(self._base_path, file_key)
        if os.path.exists(path):
            os.remove(path)
