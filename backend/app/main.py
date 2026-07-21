from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.router import api_router

# Initialize FastAPI App factory
app = FastAPI(
    title=settings.PROJECT_NAME,
    description=settings.PROJECT_DESCRIPTION,
    version=settings.VERSION,
)

# Configure CORS — allow all origins for extension + local dev access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Root status check
@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "promptly-backend"}

# Register standard v1 router under /api/v1 prefix
app.include_router(api_router, prefix=settings.API_V1_STR)

# Register legacy backwards-compatible route under /api prefix
# This ensures existing client extensions/scripts continue working without breakages
app.include_router(api_router, prefix="/api")
