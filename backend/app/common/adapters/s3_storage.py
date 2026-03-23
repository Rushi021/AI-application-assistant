import boto3

from app.common.ports import ResumeStorage
from app.core.config import get_settings


class S3ResumeStorage(ResumeStorage):
    def __init__(self) -> None:
        settings = get_settings()
        self.client = boto3.client(
            "s3",
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            endpoint_url=settings.aws_endpoint_url,
        )
        self.bucket = settings.s3_bucket_name

    def save_file(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        raise NotImplementedError("TODO: implement S3 upload")

    def get_file_url_or_path(self, file_key: str) -> str:
        raise NotImplementedError("TODO: implement S3 presigned URL")

    def get_file_bytes(self, file_key: str) -> bytes:
        raise NotImplementedError("TODO: implement S3 download")

    def delete_file(self, file_key: str) -> None:
        raise NotImplementedError("TODO: implement S3 delete")
