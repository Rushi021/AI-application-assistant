"""S3-compatible object storage for resumes (AWS S3, Cloudflare R2, MinIO, etc.)."""

from __future__ import annotations

import os
import uuid

from app.common.ports import ResumeStorage
from app.core.config import get_settings


class S3ResumeStorage(ResumeStorage):
    """Store resume blobs in a bucket; ``file_key`` is the object key returned from ``save_file``."""

    def __init__(self) -> None:
        try:
            import boto3  # type: ignore
        except ImportError as exc:
            raise RuntimeError(
                "S3 storage requires boto3. Install backend dependencies (pip install -r backend/requirements.txt)."
            ) from exc

        settings = get_settings()
        if not settings.aws_access_key_id or not settings.aws_secret_access_key:
            raise RuntimeError(
                "S3 storage requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY "
                "(or compatible credentials for your S3 endpoint)."
            )

        self._client = boto3.client(
            "s3",
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            endpoint_url=settings.aws_endpoint_url,
        )
        self._bucket = settings.s3_bucket_name

    def save_file(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        file_id = uuid.uuid4().hex
        extension = os.path.splitext(original_filename)[1].lower()
        key = f"{file_id}{extension}"
        extra: dict[str, str] = {}
        if content_type:
            extra["ContentType"] = content_type
        self._client.put_object(Bucket=self._bucket, Key=key, Body=file_bytes, **extra)
        return key

    def get_file_url_or_path(self, file_key: str) -> str:
        return f"s3://{self._bucket}/{file_key}"

    def get_file_bytes(self, file_key: str) -> bytes:
        from botocore.exceptions import ClientError

        try:
            resp = self._client.get_object(Bucket=self._bucket, Key=file_key)
            return resp["Body"].read()
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "")
            if code in ("NoSuchKey", "404", "NotFound"):
                raise FileNotFoundError(file_key) from e
            raise

    def delete_file(self, file_key: str) -> None:
        from botocore.exceptions import ClientError

        try:
            self._client.delete_object(Bucket=self._bucket, Key=file_key)
        except ClientError:
            pass
