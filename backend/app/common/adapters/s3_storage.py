from app.common.ports import ResumeStorage


class S3ResumeStorage(ResumeStorage):
    def save_file(self, file_bytes: bytes, original_filename: str, content_type: str) -> str:
        raise NotImplementedError("TODO: implement S3 upload")

    def get_file_url_or_path(self, file_key: str) -> str:
        raise NotImplementedError("TODO: implement S3 presigned URL")

    def get_file_bytes(self, file_key: str) -> bytes:
        raise NotImplementedError("TODO: implement S3 download")

    def delete_file(self, file_key: str) -> None:
        raise NotImplementedError("TODO: implement S3 delete")
