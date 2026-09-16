import express from "express";

const router = express.Router();

/*
 * Supported language mappings.
 *
 * Tesseract language code -> translation language code
 */
const LANGUAGE_CODES = {
  eng: "en",
  hin: "hi",
  tam: "ta",
  tel: "te",
  kan: "kn",
};

const SUPPORTED_LANGUAGES = new Set([
  "en",
  "hi",
  "ta",
  "te",
  "kn",
]);

const MYMEMORY_API =
  "https://api.mymemory.translated.net/get";

/*
 * Maximum size sent to MyMemory for sentence translation.
 */
const MAX_CHUNK_LENGTH = 400;

/*
 * Maximum number of unique words for word-by-word translation.
 *
 * This prevents a large OCR document from generating hundreds
 * or thousands of external API calls.
 */
const MAX_WORD_TRANSLATIONS = 100;

/*
 * Normalize incoming language.
 *
 * Examples:
 *
 * hin -> hi
 * tam -> ta
 * tel -> te
 * kan -> kn
 * eng -> en
 */
function normalizeLanguage(language) {
  if (!language) {
    return null;
  }

  const normalized = String(language)
    .trim()
    .toLowerCase();

  if (LANGUAGE_CODES[normalized]) {
    return LANGUAGE_CODES[normalized];
  }

  if (SUPPORTED_LANGUAGES.has(normalized)) {
    return normalized;
  }

  return null;
}

/*
 * Split long OCR text into smaller chunks.
 *
 * We try to split on:
 * - paragraphs
 * - sentences
 * - spaces
 *
 * This prevents very long text from being sent
 * in a single translation request.
 */
function splitText(text, maxLength = MAX_CHUNK_LENGTH) {
  const normalizedText = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();

  if (!normalizedText) {
    return [];
  }

  if (normalizedText.length <= maxLength) {
    return [normalizedText];
  }

  const paragraphs = normalizedText
    .split(/\n+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const chunks = [];

  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxLength) {
      chunks.push(paragraph);
      continue;
    }

    const sentences = paragraph.match(
      /[^.!?।]+[.!?।]?/gu
    );

    if (!sentences) {
      chunks.push(...splitByWords(paragraph, maxLength));
      continue;
    }

    let current = "";

    for (const sentence of sentences) {
      const trimmedSentence = sentence.trim();

      if (!trimmedSentence) {
        continue;
      }

      if (
        current.length + trimmedSentence.length + 1 <=
        maxLength
      ) {
        current = current
          ? `${current} ${trimmedSentence}`
          : trimmedSentence;
      } else {
        if (current) {
          chunks.push(current);
        }

        if (trimmedSentence.length <= maxLength) {
          current = trimmedSentence;
        } else {
          chunks.push(
            ...splitByWords(trimmedSentence, maxLength)
          );
          current = "";
        }
      }
    }

    if (current) {
      chunks.push(current);
    }
  }

  return chunks;
}

/*
 * Split a very long sentence by words.
 */
function splitByWords(text, maxLength) {
  const words = text.split(/\s+/);

  const chunks = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (
      current.length + word.length + 1 <=
      maxLength
    ) {
      current += ` ${word}`;
    } else {
      chunks.push(current);
      current = word;
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

/*
 * Translate a complete sentence/chunk.
 */
async function translateChunk(
  text,
  source,
  target
) {
  const url = new URL(MYMEMORY_API);

  url.searchParams.set("q", text);
  url.searchParams.set(
    "langpair",
    `${source}|${target}`
  );

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Translation provider returned HTTP ${response.status}`
    );
  }

  const data = await response.json();

  if (
    data.responseStatus &&
    Number(data.responseStatus) !== 200
  ) {
    throw new Error(
      data.responseDetails ||
        "Translation provider rejected the request."
    );
  }

  const translatedText =
    data?.responseData?.translatedText;

  if (!translatedText) {
    throw new Error(
      "Translation provider returned no translation."
    );
  }

  return translatedText;
}

/*
 * Translate complete text using chunks.
 */
async function translateFullText(
  text,
  source,
  target
) {
  const chunks = splitText(text);

  if (chunks.length === 0) {
    return "";
  }

  const translatedChunks = [];

  for (const chunk of chunks) {
    const translated = await translateChunk(
      chunk,
      source,
      target
    );

    translatedChunks.push(translated);
  }

  return translatedChunks.join("\n");
}

/*
 * Tokenize OCR text into words and punctuation.
 *
 * Unicode-aware regex is important here because
 * Hindi/Tamil/Telugu/Kannada characters are not
 * ASCII characters.
 *
 * Example:
 *
 * "यह भारत है।"
 *
 * becomes:
 *
 * ["यह", "भारत", "है", "।"]
 */
function tokenizeText(text) {
  return (
    text.match(
      /[\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}\s]/gu
    ) || []
  );
}

/*
 * Determine whether a token is a word/number
 * rather than punctuation.
 */
function isWordToken(token) {
  return /[\p{L}\p{M}\p{N}]/u.test(token);
}

/*
 * Translate one word.
 *
 * We intentionally send one word at a time here
 * because the UI wants word-by-word meaning.
 */
async function translateWord(
  word,
  source,
  target
) {
  return translateChunk(
    word,
    source,
    target
  );
}

/*
 * Word-by-word translation.
 *
 * Returns:
 *
 * [
 *   {
 *     source: "यह",
 *     target: "this"
 *   },
 *   {
 *     source: "भारत",
 *     target: "India"
 *   }
 * ]
 *
 * Repeated words are cached within this request.
 */
async function translateWords(
  text,
  source,
  target
) {
  const tokens = tokenizeText(text);

  const words = tokens.filter(isWordToken);

  if (words.length === 0) {
    return [];
  }

  /*
   * Remove duplicates while preserving order.
   */
  const uniqueWords = [
    ...new Set(words),
  ];

  /*
   * Protect the external translation service
   * from very large OCR documents.
   */
  const wordsToTranslate =
    uniqueWords.slice(
      0,
      MAX_WORD_TRANSLATIONS
    );

  const cache = new Map();

  /*
   * Translate sequentially.
   *
   * We intentionally do not use Promise.all()
   * because that could generate a large number
   * of simultaneous external requests.
   */
  for (const word of wordsToTranslate) {
    try {
      const translated = await translateWord(
        word,
        source,
        target
      );

      cache.set(word, translated);
    } catch (error) {
      console.error(
        `Failed to translate word "${word}":`,
        error.message
      );

      /*
       * Keep the original word if individual
       * word translation fails.
       */
      cache.set(word, word);
    }
  }

  /*
   * Build final word-by-word result.
   */
  return words.map((word) => ({
    source: word,
    target: cache.get(word) || word,
  }));
}

/*
 * POST /api/translate
 *
 * Request:
 *
 * {
 *   "text": "यह भारत है",
 *   "source": "hi",
 *   "target": "en"
 * }
 *
 * Response:
 *
 * {
 *   "translation": "This is India",
 *   "words": [
 *      {
 *        "source": "यह",
 *        "target": "this"
 *      }
 *   ]
 * }
 */
router.post("/", async (req, res) => {
  try {
    const {
      text,
      source,
      target,
    } = req.body;

    /*
     * Validate text
     */
    if (
      typeof text !== "string" ||
      !text.trim()
    ) {
      return res.status(400).json({
        error: "Text is required.",
      });
    }

    /*
     * Normalize languages
     */
    const normalizedSource =
      normalizeLanguage(source);

    const normalizedTarget =
      normalizeLanguage(target);

    /*
     * Validate source language
     */
    if (!normalizedSource) {
      return res.status(400).json({
        error:
          "Unsupported source language. Supported languages: en, hi, ta, te, kn.",
      });
    }

    /*
     * Validate target language
     */
    if (!normalizedTarget) {
      return res.status(400).json({
        error:
          "Unsupported target language. Supported languages: en, hi, ta, te, kn.",
      });
    }

    /*
     * If source and target are identical,
     * no external translation is necessary.
     */
    if (
      normalizedSource === normalizedTarget
    ) {
      const tokens = tokenizeText(text);

      const words = tokens
        .filter(isWordToken)
        .map((word) => ({
          source: word,
          target: word,
        }));

      return res.json({
        translation: text.trim(),
        words,
        source: normalizedSource,
        target: normalizedTarget,
        chunks: 1,
      });
    }

    console.log(
      `Translation request: ${normalizedSource} -> ${normalizedTarget}`
    );

    /*
     * 1. Natural translation
     */
    const chunks = splitText(text);

    const translatedChunks = [];

    for (const chunk of chunks) {
      console.log(
        `Translating chunk (${chunk.length} characters)`
      );

      const translated =
        await translateChunk(
          chunk,
          normalizedSource,
          normalizedTarget
        );

      translatedChunks.push(translated);
    }

    const translation =
      translatedChunks.join("\n");

    /*
     * 2. Word-by-word translation
     */
    console.log(
      "Generating word-by-word translation..."
    );

    const words =
      await translateWords(
        text,
        normalizedSource,
        normalizedTarget
      );

    /*
     * Return both natural and word-by-word
     * translations.
     */
    return res.json({
      translation,
      words,
      source: normalizedSource,
      target: normalizedTarget,
      chunks: chunks.length,
    });
  } catch (error) {
    console.error(
      "Translation error:",
      error
    );

    return res.status(500).json({
      error:
        error?.message ||
        "Translation failed.",
    });
  }
});

export default router;