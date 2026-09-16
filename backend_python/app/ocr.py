from io import BytesIO
import os
from typing import Optional

import fitz
import pytesseract
from PIL import Image, ImageOps

from .config import TESSERACT_CMD

if TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

LANG_CODES = {
    "hindi": "hin",
    "tamil": "tam",
    "telugu": "tel",
    "kannada": "kan",
    "english": "eng",
}

def language_code(language: str) -> str:
    key = language.lower().strip()
    if key not in LANG_CODES:
        raise ValueError(f"Unsupported OCR language: {language}")
    return LANG_CODES[key]

def preprocess(image: Image.Image) -> Image.Image:
    image = image.convert("RGB")
    image = ImageOps.exif_transpose(image)
    # Upscale smaller scans to improve OCR.
    if image.width < 1600:
        scale = 1600 / image.width
        image = image.resize(
            (int(image.width * scale), int(image.height * scale))
        )
    return image

def ocr_image(image: Image.Image, source_language: str) -> str:
    image = preprocess(image)
    code = language_code(source_language)
    text = pytesseract.image_to_string(
        image,
        lang=code,
        config="--psm 6"
    )
    return text.strip()

def extract_pdf_text_or_ocr(
    data: bytes,
    source_language: str
) -> list[dict]:
    document = fitz.open(stream=data, filetype="pdf")
    pages = []

    try:
        for index, page in enumerate(document):
            text = page.get_text("text").strip()

            # If the PDF has no selectable text, render the page and OCR it.
            if not text:
                pix = page.get_pixmap(
                    matrix=fitz.Matrix(2.0, 2.0),
                    alpha=False
                )
                image = Image.open(BytesIO(pix.tobytes("png")))
                text = ocr_image(image, source_language)
                extraction_mode = "ocr"
            else:
                extraction_mode = "pdf-text"

            pages.append({
                "page": index + 1,
                "original_text": text,
                "extraction_mode": extraction_mode,
            })
    finally:
        document.close()

    return pages

def extract_image(data: bytes, source_language: str) -> list[dict]:
    image = Image.open(BytesIO(data))
    text = ocr_image(image, source_language)
    return [{
        "page": 1,
        "original_text": text,
        "extraction_mode": "ocr",
    }]
