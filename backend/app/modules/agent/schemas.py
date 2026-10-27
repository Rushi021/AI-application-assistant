import re
from typing import Literal
from pydantic import BaseModel, Field, field_validator


class Source(BaseModel):
    provider: Literal[
        "greenhouse", "lever", "ashby", "workday", "remotive", "google_jobs"
    ]
    board: str = ""

    @field_validator("board")
    @classmethod
    def board_slug(cls, value):
        if value and not re.fullmatch(r"[a-zA-Z0-9_.-]{1,150}", value):
            raise ValueError("Use the board identifier, not a URL")
        return value


class PlanConfig(BaseModel):
    enabled: bool = False
    resume_id: int = Field(gt=0)
    roles: list[str] = Field(min_length=1, max_length=10)
    locations: list[str] = Field(
        default_factory=lambda: ["Remote"], min_length=1, max_length=10
    )
    sources: list[Source] = Field(min_length=1, max_length=30)
    minimum_score: float = Field(default=0.65, ge=0, le=1)
    interval_minutes: int = Field(default=60, ge=5, le=10080)
    max_prepare: int = Field(default=10, ge=1, le=50)
    instructions: str = Field(default="", max_length=4000)

    @field_validator("roles", "locations")
    @classmethod
    def clean_list(cls, values):
        values = list(dict.fromkeys(v.strip() for v in values if v.strip()))
        if not values:
            raise ValueError("Provide at least one nonempty value")
        return values


class Decision(BaseModel):
    resume_id: int | None = Field(default=None, gt=0)
    action: Literal["approve", "reject", "reprepare"]


class Result(BaseModel):
    lease_token: str
    state: Literal["submitted", "needs_attention", "failed"]
    detail: str = Field(default="", max_length=3000)
    url: str


class Claim(BaseModel):
    item_id: int | None = None
