import re
from typing import List
from app.models.schemas import AnalysisIssue
from app.services.ai_engine import expand_short_prompt

WEAK_OPENERS = [
    "write a", "give me a", "make a", "create a", "generate a",
    "tell me about", "make a video about", "write me a", "can you",
    "please write", "i want a", "i need a", "help me with",
    "do a", "come up with", "think of a", "put together a",
    "draft a", "build a", "design a"
]

# ─── Domain keyword → role/scope templates for local fallback ────────
_DOMAIN_TEMPLATES = {
    "website": (
        "Act as an expert full-stack web developer. Help me build a modern, "
        "responsive website. Please provide a step-by-step architecture plan "
        "including tech stack recommendations, page structure, and key features."
    ),
    "web app": (
        "Act as a senior full-stack engineer. Help me design and build a "
        "production-ready web application. Include architecture, tech stack, "
        "database schema, and a phased implementation plan."
    ),
    "app": (
        "Act as a senior software architect. Help me plan and build an "
        "application. Outline the architecture, core features, tech stack, "
        "and a clear development roadmap."
    ),
    "api": (
        "Act as a backend API architect. Help me design a robust, well-structured "
        "REST API. Include endpoint design, authentication, data models, and "
        "error handling best practices."
    ),
    "blog": (
        "Act as a professional content strategist and writer. Help me create "
        "a compelling blog post. Define the target audience, outline key sections, "
        "tone of voice, and SEO considerations."
    ),
    "essay": (
        "Act as an academic writing expert. Help me compose a well-structured "
        "essay. Specify the thesis statement, supporting arguments, evidence "
        "requirements, and formatting guidelines."
    ),
    "email": (
        "Act as a professional communications expert. Help me draft a clear, "
        "effective email. Specify the recipient context, purpose, desired tone, "
        "and call-to-action."
    ),
    "code": (
        "Act as a senior software engineer. Help me write clean, well-documented "
        "code. Specify the programming language, expected inputs/outputs, edge "
        "cases, and testing strategy."
    ),
    "story": (
        "Act as a creative fiction writer. Help me craft an engaging story. "
        "Define the genre, setting, main characters, conflict, and narrative "
        "arc before writing."
    ),
    "poem": (
        "Act as an accomplished poet. Help me write a meaningful poem. Specify "
        "the form (sonnet, free verse, haiku, etc.), theme, mood, and any "
        "stylistic constraints."
    ),
    "logo": (
        "Act as a professional brand designer. Help me create a logo concept. "
        "Define the brand personality, color palette preferences, style "
        "(minimalist, vintage, modern), and usage context."
    ),
    "resume": (
        "Act as a career coach and resume expert. Help me build a compelling "
        "resume. Specify the target role, industry, years of experience, and "
        "key accomplishments to highlight."
    ),
    "presentation": (
        "Act as a presentation design expert. Help me create a professional "
        "slide deck. Outline the audience, key message, number of slides, "
        "data visualization needs, and visual style."
    ),
    "script": (
        "Act as an experienced screenwriter. Help me write a polished script. "
        "Define the format (short film, YouTube, ad), target audience, tone, "
        "and key scenes or beats."
    ),
}

_GENERIC_TEMPLATE = (
    "Act as a senior expert in the relevant domain. "
    "Please clarify my request by providing: "
    "(1) your specific role and expertise, "
    "(2) the exact deliverables expected, "
    "(3) any constraints such as length, format, or audience, and "
    "(4) a step-by-step approach to fulfill this request."
)


def _build_context_suggestion(text: str) -> str:
    """Build a structured prompt suggestion using keyword matching.
    Returns a domain-specific template or a generic fallback."""
    text_lower = text.lower()

    # Check domain keywords (longest key first for best match)
    for keyword in sorted(_DOMAIN_TEMPLATES, key=len, reverse=True):
        if keyword in text_lower:
            return _DOMAIN_TEMPLATES[keyword]

    # Generic fallback: wrap the user's intent into a structured template
    stripped = text.strip().rstrip(".")
    return (
        f"Act as a senior expert. I need help with the following: {stripped}. "
        f"Please provide (1) a clear plan of action, "
        f"(2) the exact deliverables, "
        f"(3) any constraints or assumptions, and "
        f"(4) a step-by-step approach."
    )


async def analyze_local(text: str) -> List[AnalysisIssue]:
    issues = []
    text_lower = text.lower()
    
    # 1. Weak opener prefix match (longest prefix match first)
    sorted_openers = sorted(WEAK_OPENERS, key=len, reverse=True)
    for opener in sorted_openers:
        if text_lower.startswith(opener):
            start_idx = 0
            end_idx = len(opener)
            matched_slice = text[start_idx:end_idx]
            
            issues.append(AnalysisIssue(
                start_idx=start_idx,
                end_idx=end_idx,
                target_text=matched_slice,
                category="Clarity",
                description="Weak imperative opener. Consider replacing it with a more direct role/context definition (e.g., 'Compose a structured' or 'Act as a...').",
                suggestion="Compose a structured",
                source="local"
            ))
            break  # Stop after first (longest) match
            
    # 2. Length check (Context Deficit) — always produce a real suggestion
    if len(text.strip()) < 40:
        # Try Gemini expansion first, fall back to local template
        ai_suggestion = await expand_short_prompt(text)
        suggestion = ai_suggestion if ai_suggestion else _build_context_suggestion(text)

        issues.append(AnalysisIssue(
            start_idx=0,
            end_idx=len(text),
            target_text=text,
            category="Context",
            description=(
                f"Context deficit. The prompt is too short ({len(text.strip())} chars) "
                f"to convey proper context, instructions, or goals. "
                f"Use the suggested optimization to transform this into a detailed, role-based request."
            ),
            suggestion=suggestion,
            source="local"
        ))
        
    return issues
