from fastapi import APIRouter, HTTPException
from app.models.schemas import AnalyzeRequest, AnalyzeResponse
from app.services.pipeline import run_pipeline

router = APIRouter()

@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_prompt_endpoint(payload: AnalyzeRequest):
    try:
        response = await run_pipeline(payload.prompt_text)
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Internal Server Error: {str(e)}")
