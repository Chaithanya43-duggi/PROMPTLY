from pydantic import BaseModel, Field
from typing import Literal, List, Optional

class AnalyzeRequest(BaseModel):
    prompt_text: str

class AnalysisIssue(BaseModel):
    start_idx: int = Field(description="Zero-based start index (inclusive) of the target text")
    end_idx: int = Field(description="Zero-based end index (exclusive) of the target text")
    target_text: str = Field(description="The exact slice of prompt text from start_idx to end_idx")
    category: Literal["Clarity", "Context", "Constraints"]
    description: str = Field(description="Explanation of the issue found")
    suggestion: str = Field(description="Proposed replacement text")
    source: Literal["local", "ai"]

class AnalyzeResponse(BaseModel):
    issues: List[AnalysisIssue]
    processing_time_ms: int
    warning: Optional[str] = None
