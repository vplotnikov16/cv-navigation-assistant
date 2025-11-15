import logging
from app import app

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
logger.info("server module imported; app ready")

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "server:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info",
    )
