from typing import Annotated

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import FRONTEND_ORIGIN
from .ocr import (
    LANG_CODES,
    extract_image,
    extract_pdf_text_or_ocr,
)
from .translator import translate_text

app = FastAPI(
    title="Indian Language Document Translator",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_ORIGIN, "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

IMAGE_TYPES = {
    "image/png",
    "image/jpeg",
    "image/jpg",
    "image/webp",
}

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.get("/api/languages")
def languages():
    return {
        "ocr_languages": list(LANG_CODES.keys()),
        "translation_languages": [
            "english",
            "hindi",
            "tamil",
            "telugu",
            "kannada",
        ],
    }

@app.post("/api/translate")
async def translate_document(
    file: Annotated[UploadFile, File(...)],
    source_language: Annotated[str, Form(...)],
    target_language: Annotated[str, Form(...)],
):
    if source_language not in LANG_CODES:
        raise HTTPException(400, "Unsupported source language")

    allowed_targets = {"english", "hindi", "tamil", "telugu", "kannada"}
    if target_language not in allowed_targets:
        raise HTTPException(400, "Unsupported target language")

    filename = file.filename or "document"
    content_type = file.content_type or ""
    data = await file.read()

    if not data:
        raise HTTPException(400, "The uploaded file is empty")

    try:
        if content_type == "application/pdf" or filename.lower().endswith(".pdf"):
            pages = extract_pdf_text_or_ocr(data, source_language)
        elif content_type in IMAGE_TYPES:
            pages = extract_image(data, source_language)
        else:
            raise HTTPException(
                415,
                "Upload a PDF, PNG, JPG, JPEG or WebP file."
            )

        for page in pages:
            page["translated_text"] = translate_text(
                page["original_text"],
                source_language,
                target_language,
            )

        return {
            "filename": filename,
            "source_language": source_language,
            "target_language": target_language,
            "pages": pages,
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(
            500,
            f"Processing failed: {str(exc)}"
        ) from exc
