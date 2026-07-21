import time
import os
from typing import List
from app.models.schemas import AnalyzeResponse, AnalysisIssue
from app.services.local_nlp import analyze_local
from app.services.ai_engine import analyze_ai, GeminiIssue

def find_substring_occurrences(text: str, sub: str) -> List[int]:
    occurrences = []
    if not sub:
        return occurrences
    start = 0
    while True:
        start = text.find(sub, start)
        if start == -1:
            break
        occurrences.append(start)
        start += len(sub)
    return occurrences

def validate_and_align_coordinates(text: str, raw_ai_issues: List[GeminiIssue]) -> List[AnalysisIssue]:
    valid_issues = []
    for issue in raw_ai_issues:
        start = issue.start_idx
        end = issue.end_idx
        target = issue.target_text
        
        # Range validity checks
        if start < 0 or end > len(text) or start >= end:
            continue
            
        actual_slice = text[start:end]
        if actual_slice != target:
            # String mismatch: attempt correction
            occurrences = find_substring_occurrences(text, target)
            if occurrences:
                # Find the occurrence closest to the start index returned by the model
                closest_start = min(occurrences, key=lambda x: abs(x - start))
                start = closest_start
                end = closest_start + len(target)
            else:
                # Target text not found anywhere in the raw text: discard issue
                continue
                
        valid_issues.append(AnalysisIssue(
            start_idx=start,
            end_idx=end,
            target_text=target,
            category=issue.category,
            description=issue.description,
            suggestion=issue.suggestion,
            source="ai"
        ))
    return valid_issues

async def run_pipeline(text: str) -> AnalyzeResponse:
    start_time = time.time()
    
    # 1. Local Syntactic Filter
    local_issues = await analyze_local(text)
    
    # 2. Asynchronous Semantic LLM Filter
    raw_ai_issues = await analyze_ai(text)
    
    # 3. Coordinate validation & alignment checks
    aligned_ai_issues = validate_and_align_coordinates(text, raw_ai_issues)
    
    # 4. Merge issues and resolve overlapping coordinate boundaries
    # Sort all issues by start index first
    all_issues = sorted(local_issues + aligned_ai_issues, key=lambda x: x.start_idx)
    merged_issues = []
    
    last_end = -1
    for issue in all_issues:
        # If there's an overlap (start of current issue is before the end of the previous issue)
        if issue.start_idx < last_end:
            # Overlap conflict resolution: prioritize AI over local checks
            if issue.source == "ai" and merged_issues and merged_issues[-1].source == "local":
                merged_issues.pop()  # Drop the local rule
                merged_issues.append(issue)
                last_end = issue.end_idx
            # Otherwise, keep the first one and discard the overlapping issue
            continue
            
        merged_issues.append(issue)
        last_end = issue.end_idx
        
    warning_msg = None
    if not os.getenv("GEMINI_API_KEY"):
        warning_msg = "Gemini API key is not configured. Running in Local-Only Syntactic mode."
        
    return AnalyzeResponse(
        issues=merged_issues,
        processing_time_ms=int((time.time() - start_time) * 1000),
        warning=warning_msg
    )
