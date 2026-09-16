import os
from dotenv import load_dotenv

load_dotenv()

TESSERACT_CMD = os.getenv("TESSERACT_CMD", "").strip()
TRANSLATION_URL = os.getenv(
    "TRANSLATION_URL",
    "https://libretranslate.com/translate"
).strip()
TRANSLATION_API_KEY = os.getenv("TRANSLATION_API_KEY", "").strip()
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173").strip()
