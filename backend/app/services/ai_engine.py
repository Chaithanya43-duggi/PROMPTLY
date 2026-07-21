import os
import asyncio
from typing import List, Literal
from pydantic import BaseModel, Field
from google import genai
from dotenv import load_dotenv

load_dotenv()

class GeminiIssue(BaseModel):
    start_idx: int = Field(description="Zero-based start index (inclusive) of the target text issue in the raw prompt.")
    end_idx: int = Field(description="Zero-based end index (exclusive) of the target text issue in the raw prompt.")
    target_text: str = Field(description="The exact slice of prompt text from start_idx to end_idx.")
    category: Literal["Clarity", "Context", "Constraints"]
    description: str = Field(description="Explanation of the issue found.")
    suggestion: str = Field(description="Proposed replacement text.")

class GeminiContainer(BaseModel):
    issues: List[GeminiIssue]

SYSTEM_INSTRUCTION = """
You are Promptly's AI prompt analysis engine. Your role is to analyze a user's prompt and identify semantic and structural weaknesses.
Focus exclusively on these issues:
1. MISSING CONSTRAINTS: Flag subjective, vague, or non-measurable criteria (e.g., "not too long", "make it engaging", "keep it brief", "highly professional", "make it interesting"). Suggest concrete, measurable alternatives (e.g., "under 500 words", "in a persuasive, conversational tone", "summarized in 3 bullet points").
2. MISSING CONTEXT: Flag prompts that lack target audience, operational profile, background baseline data, role/persona, or specific format requirements.
3. CLARITY: Flag ambiguous phrasing, jargon without definitions, or unclear instruction boundaries.

Rules:
- For every issue detected, you must determine the EXACT zero-based index coordinates ('start_idx' and 'end_idx') where the weak substring is located in the user prompt.
- The 'target_text' field must match EXACTLY the character-for-character substring of the prompt text from start_idx to end_idx.
- Ignore simple verb/imperative openers (e.g., "Write a", "Create a", "Give me a") at the start, and ignore prompt length issues, as these are handled by a separate local parser.
"""

# Model fallback chain — try each in order if the previous one is rate-limited
MODEL_CHAIN = [
    "gemini-3.5-flash-lite",
    "gemini-3.5-flash",
    "gemini-2.0-flash-lite",
]

MAX_RETRIES = 2
BASE_RETRY_DELAY = 1.0  # seconds


def get_client() -> genai.Client:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None
    try:
        return genai.Client(api_key=api_key)
    except Exception:
        return None


def _is_rate_limit_error(e: Exception) -> bool:
    """Check if an exception is a 429 rate limit error."""
    err_str = str(e)
    return "429" in err_str or "RESOURCE_EXHAUSTED" in err_str


async def _call_gemini(client, model: str, contents: str, config: dict) -> str:
    """Call Gemini API with retry logic for a single model."""
    last_error = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            return response.text
        except Exception as e:
            last_error = e
            if _is_rate_limit_error(e) and attempt < MAX_RETRIES:
                delay = BASE_RETRY_DELAY * (2 ** attempt)
                print(f"[AI Engine] Rate limited on {model}, retrying in {delay}s (attempt {attempt + 1}/{MAX_RETRIES})")
                await asyncio.sleep(delay)
            else:
                raise
    raise last_error


async def _call_with_fallback(client, contents: str, config: dict, models: list) -> str:
    """Try each model in the chain, falling back on rate limit errors."""
    last_error = None
    for model in models:
        try:
            result = await _call_gemini(client, model, contents, config)
            return result
        except Exception as e:
            last_error = e
            if _is_rate_limit_error(e):
                print(f"[AI Engine] Model {model} rate-limited, trying next fallback...")
                continue
            else:
                # Non-rate-limit error, don't try other models
                raise
    raise last_error


async def analyze_ai(text: str) -> List[GeminiIssue]:
    client = get_client()
    if not client:
        # No client available (missing API key or client initialization error)
        return []
        
    try:
        # Run content generation targeting structured schema
        response_text = await _call_with_fallback(
            client,
            contents=f"Analyze this prompt:\n\n{text}",
            config={
                "response_mime_type": "application/json",
                "response_schema": GeminiContainer,
                "system_instruction": SYSTEM_INSTRUCTION
            },
            models=MODEL_CHAIN,
        )
        
        parsed = GeminiContainer.model_validate_json(response_text)
        return parsed.issues
    except Exception as e:
        # Gracefully handle API errors, quota issues, or validation errors
        print(f"[AI Engine Error] {e}")
        return []


EXPAND_SYSTEM_INSTRUCTION = """\
You are Promptly's prompt expansion engine. The user wrote a very short, vague prompt.
Your job is to rewrite it into a single, detailed, production-ready prompt that an AI assistant would respond to excellently.

Rules:
- Start with a clear role assignment (e.g., "Act as an expert …").
- Include explicit scope, deliverables, and constraints.
- Preserve the user's original intent — do NOT change what they are asking for.
- Output ONLY the expanded prompt text. No commentary, no markdown fences, no preamble.
- Keep the result under 280 characters so it fits comfortably in a chat input box.
"""


class ExpandedPrompt(BaseModel):
    expanded: str = Field(description="The expanded, production-ready prompt.")


async def expand_short_prompt(text: str) -> str | None:
    """Ask Gemini to expand a short/vague prompt into a detailed one.
    Returns the expanded string, or None if the API is unavailable."""
    client = get_client()
    if not client:
        return None

    try:
        response_text = await _call_with_fallback(
            client,
            contents=f"Expand this short prompt:\n\n{text}",
            config={
                "response_mime_type": "application/json",
                "response_schema": ExpandedPrompt,
                "system_instruction": EXPAND_SYSTEM_INSTRUCTION,
            },
            models=MODEL_CHAIN,
        )
        parsed = ExpandedPrompt.model_validate_json(response_text)
        return parsed.expanded if parsed.expanded.strip() else None
    except Exception as e:
        print(f"[AI Engine Expand Error] {e}")
        return None
