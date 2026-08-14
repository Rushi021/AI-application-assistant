from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class ExtractedRequirement(BaseModel):
    text: str
    kind: Literal["must_have", "nice_to_have"]
    category: str = "skill"
    weight: float = Field(default=1.0, ge=0.0)


class RequirementList(BaseModel):
    requirements: list[ExtractedRequirement] = Field(default_factory=list)
