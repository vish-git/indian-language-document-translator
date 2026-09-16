import requests

from .config import TRANSLATION_API_KEY, TRANSLATION_URL

LANG_MAP = {
    "english": "en",
    "hindi": "hi",
    "tamil": "ta",
    "telugu": "te",
    "kannada": "kn",
}

def translate_text(
    text: str,
    source_language: str,
    target_language: str
) -> str:
    if not text.strip():
        return ""

    source = LANG_MAP.get(source_language.lower().strip())
    target = LANG_MAP.get(target_language.lower().strip())

    if not source or not target:
        raise ValueError("Unsupported translation language")

    # Already the same language.
    if source == target:
        return text

    payload = {
        "q": text,
        "source": source,
        "target": target,
        "format": "text",
    }

    if TRANSLATION_API_KEY:
        payload["api_key"] = TRANSLATION_API_KEY

    response = requests.post(
        TRANSLATION_URL,
        data=payload,
        timeout=90,
    )
    response.raise_for_status()
    result = response.json()

    translated = result.get("translatedText")
    if translated is None:
        raise RuntimeError(
            "Translation provider returned an unexpected response."
        )
    return translated
