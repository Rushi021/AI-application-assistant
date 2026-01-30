from pydantic import BaseModel


class UserRead(BaseModel):
    id: int
    username: str

    class Config:
        from_attributes = True
