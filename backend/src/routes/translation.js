import express from "express";

const router = express.Router();

/*
 * ============================================
 * Supported languages
 * ============================================
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

/*
 * ============================================
 * Translation provider
 * ============================================
 */

const MYMEMORY_API =
  "https://api.mymemory.translated.net/get";

/*
 * Keep normal translation requests reasonably
 * small because public translation services
 * can reject very large requests.
 */
const MAX_CHUNK_LENGTH = 400;

/*
 * Word translation settings.
 *
 * IMPORTANT:
 *
 * Old implementation:
 *
 *   word 1 -> API
 *   word 2 -> API
 *   word 3 -> API
 *   ...
 *   word 100 -> API
 *
 * New implementation:
 *
 *   40 words -> ONE API request
 *   40 words -> ONE API request
 *   20 words -> ONE API request
 *
 * This dramatically reduces API traffic.
 */

const MAX_WORD_TRANSLATIONS = 100;

const WORD_BATCH_SIZE = 35;

/*
 * Delay between word batches.
 *
 * This gives the public translation provider
 * some breathing room.
 */
const WORD_BATCH_DELAY_MS = 500;

/*
 * Retry settings for HTTP 429.
 */

const MAX_RETRIES = 3;

const INITIAL_RETRY_DELAY_MS = 1500;

/*
 * ============================================
 * Utility functions
 * ============================================
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
 * Sleep helper.
 */
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/*
 * ============================================
 * Text splitting
 * ============================================
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
      current.length +
        word.length +
        1 <=
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

function splitText(
  text,
  maxLength = MAX_CHUNK_LENGTH
) {
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

    /*
     * Supports:
     *
     * .
     * !
     * ?
     * ।
     *
     * This is useful for Indian-language text.
     */
    const sentences =
      paragraph.match(
        /[^.!?।]+[.!?।]?/gu
      );

    if (!sentences) {
      chunks.push(
        ...splitByWords(
          paragraph,
          maxLength
        )
      );

      continue;
    }

    let current = "";

    for (const sentence of sentences) {
      const trimmedSentence =
        sentence.trim();

      if (!trimmedSentence) {
        continue;
      }

      if (
        current.length +
          trimmedSentence.length +
          1 <=
        maxLength
      ) {
        current = current
          ? `${current} ${trimmedSentence}`
          : trimmedSentence;
      } else {
        if (current) {
          chunks.push(current);
        }

        if (
          trimmedSentence.length <=
          maxLength
        ) {
          current = trimmedSentence;
        } else {
          chunks.push(
            ...splitByWords(
              trimmedSentence,
              maxLength
            )
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
 * ============================================
 * MyMemory request
 * ============================================
 *
 * This function handles:
 *
 * - normal HTTP errors
 * - HTTP 429
 * - retries
 */

async function requestMyMemory(
  text,
  source,
  target,
  options = {}
) {
  const {
    retries = MAX_RETRIES,
    retryDelay = INITIAL_RETRY_DELAY_MS,
  } = options;

  const url = new URL(
    MYMEMORY_API
  );

  url.searchParams.set(
    "q",
    text
  );

  url.searchParams.set(
    "langpair",
    `${source}|${target}`
  );

  /*
   * MyMemory supports this parameter for
   * identifying the requester.
   */
  url.searchParams.set(
    "de",
    "local-translator-app@example.com"
  );

  let lastError = null;

  for (
    let attempt = 0;
    attempt <= retries;
    attempt++
  ) {
    try {
      const response =
        await fetch(url, {
          headers: {
            Accept:
              "application/json",
            "User-Agent":
              "MultilingualDocumentTranslator/1.0",
          },
        });

      /*
       * ========================================
       * HTTP 429
       * ========================================
       */

      if (
        response.status === 429
      ) {
        const retryAfterHeader =
          response.headers.get(
            "retry-after"
          );

        let waitTime =
          retryDelay *
          Math.pow(2, attempt);

        /*
         * If provider supplies Retry-After,
         * prefer that value.
         */
        if (retryAfterHeader) {
          const retryAfterSeconds =
            Number(
              retryAfterHeader
            );

          if (
            Number.isFinite(
              retryAfterSeconds
            )
          ) {
            waitTime =
              retryAfterSeconds *
              1000;
          }
        }

        if (attempt < retries) {
          console.warn(
            `MyMemory returned HTTP 429. ` +
              `Retrying in ${Math.round(
                waitTime / 1000
              )} seconds...`
          );

          await sleep(waitTime);

          continue;
        }

        throw new Error(
          "Translation service is temporarily rate-limiting requests (HTTP 429). Please wait a moment and try again."
        );
      }

      /*
       * Other HTTP errors.
       */

      if (!response.ok) {
        throw new Error(
          `Translation provider returned HTTP ${response.status}`
        );
      }

      const data =
        await response.json();

      /*
       * MyMemory may return a responseStatus
       * even when the HTTP status is 200.
       */

      if (
        data.responseStatus &&
        Number(
          data.responseStatus
        ) !== 200
      ) {
        throw new Error(
          data.responseDetails ||
            "Translation provider rejected the request."
        );
      }

      const translatedText =
        data?.responseData
          ?.translatedText;

      if (
        !translatedText
      ) {
        throw new Error(
          "Translation provider returned no translation."
        );
      }

      return translatedText;
    } catch (error) {
      lastError = error;

      /*
       * Network errors can be retried too.
       *
       * Do not retry arbitrary application
       * errors indefinitely.
       */

      const message =
        error instanceof Error
          ? error.message
          : String(error);

      const isRateLimit =
        message.includes(
          "HTTP 429"
        ) ||
        message.includes(
          "rate-limiting"
        );

      if (
        isRateLimit &&
        attempt < retries
      ) {
        const waitTime =
          retryDelay *
          Math.pow(2, attempt);

        console.warn(
          `Retrying translation request in ${Math.round(
            waitTime / 1000
          )} seconds...`
        );

        await sleep(waitTime);

        continue;
      }

      throw error;
    }
  }

  throw (
    lastError ||
    new Error(
      "Translation failed."
    )
  );
}

/*
 * ============================================
 * Sentence/chunk translation
 * ============================================
 */

async function translateChunk(
  text,
  source,
  target
) {
  return requestMyMemory(
    text,
    source,
    target
  );
}

/*
 * ============================================
 * Tokenization
 * ============================================
 *
 * Supports Unicode letters, marks and numbers.
 *
 * This works for:
 *
 * English
 * Hindi
 * Tamil
 * Telugu
 * Kannada
 */

function tokenizeText(text) {
  return (
    text.match(
      /[\p{L}\p{M}\p{N}]+|[^\p{L}\p{M}\p{N}\s]/gu
    ) || []
  );
}

function isWordToken(token) {
  return /[\p{L}\p{M}\p{N}]/u.test(
    token
  );
}

/*
 * ============================================
 * Word batching
 * ============================================
 *
 * Example:
 *
 * [
 *   "नमस्ते",
 *   "आप",
 *   "कैसे",
 *   "हैं"
 * ]
 *
 * becomes:
 *
 * नमस्ते
 * आप
 * कैसे
 * हैं
 *
 * and is sent as ONE translation request.
 *
 * Newline is used as the separator so that
 * the response can be mapped back to the
 * original words.
 */

function createWordBatches(
  words,
  batchSize = WORD_BATCH_SIZE
) {
  const batches = [];

  for (
    let i = 0;
    i < words.length;
    i += batchSize
  ) {
    batches.push(
      words.slice(
        i,
        i + batchSize
      )
    );
  }

  return batches;
}

/*
 * Normalize a translated batch.
 *
 * Translation providers don't always preserve
 * line breaks perfectly, so we support several
 * formats.
 */

function parseTranslatedWordBatch(
  translatedText,
  expectedCount
) {
  if (!translatedText) {
    return [];
  }

  /*
   * First try newline-based mapping.
   */

  let lines =
    translatedText
      .split(/\r?\n/)
      .map((line) =>
        line.trim()
      )
      .filter(Boolean);

  /*
   * Sometimes the provider may return
   * semicolon-separated output.
   */

  if (
    lines.length === 1 &&
    expectedCount > 1 &&
    lines[0].includes(";")
  ) {
    lines = lines[0]
      .split(";")
      .map((item) =>
        item.trim()
      )
      .filter(Boolean);
  }

  /*
   * We intentionally don't try to invent
   * mappings if the provider returns fewer
   * translations than requested.
   *
   * Returning fewer entries is safer than
   * incorrectly pairing words.
   */

  return lines;
}

/*
 * ============================================
 * Batch word translation
 * ============================================
 *
 * IMPORTANT:
 *
 * This replaces the old:
 *
 *   translateWord(word)
 *
 * loop.
 *
 * Instead of 100 API calls, we make roughly
 * 3 API calls for 100 words.
 */

async function translateWordBatch(
  words,
  source,
  target
) {
  if (!words.length) {
    return [];
  }

  /*
   * Put one word per line.
   */

  const batchText =
    words.join("\n");

  try {
    const translated =
      await translateChunk(
        batchText,
        source,
        target
      );

    const translatedWords =
      parseTranslatedWordBatch(
        translated,
        words.length
      );

    /*
     * If provider preserved all lines,
     * map them directly.
     */

    if (
      translatedWords.length ===
      words.length
    ) {
      return words.map(
        (word, index) => ({
          source: word,
          target:
            translatedWords[
              index
            ] || word,
        })
      );
    }

    /*
     * If response couldn't be reliably
     * mapped, don't create incorrect
     * source/target relationships.
     *
     * Fall back to original words.
     */

    console.warn(
      `Could not reliably map word batch. Expected ${words.length} translations but received ${translatedWords.length}.`
    );

    return words.map(
      (word) => ({
        source: word,
        target: word,
      })
    );
  } catch (error) {
    console.error(
      "Word batch translation failed:",
      error.message
    );

    /*
     * Word-by-word translation is an
     * enhancement. It must never make the
     * main sentence translation fail.
     */

    return words.map(
      (word) => ({
        source: word,
        target: word,
      })
    );
  }
}

/*
 * ============================================
 * Translate words
 * ============================================
 */

async function translateWords(
  text,
  source,
  target
) {
  const tokens =
    tokenizeText(text);

  const words =
    tokens.filter(
      isWordToken
    );

  if (!words.length) {
    return [];
  }

  /*
   * Remove duplicate words while preserving
   * the original order.
   */

  const uniqueWords = [
    ...new Set(words),
  ];

  /*
   * Protect the backend from unexpectedly
   * large OCR documents.
   */

  const wordsToTranslate =
    uniqueWords.slice(
      0,
      MAX_WORD_TRANSLATIONS
    );

  const batches =
    createWordBatches(
      wordsToTranslate,
      WORD_BATCH_SIZE
    );

  console.log(
    `Word translation: ${wordsToTranslate.length} unique words in ${batches.length} API batch(es).`
  );

  const cache =
    new Map();

  for (
    let i = 0;
    i < batches.length;
    i++
  ) {
    const batch =
      batches[i];

    console.log(
      `Translating word batch ${
        i + 1
      }/${batches.length} (${batch.length} words)`
    );

    const translatedBatch =
      await translateWordBatch(
        batch,
        source,
        target
      );

    for (
      const item of translatedBatch
    ) {
      cache.set(
        item.source,
        item.target
      );
    }

    /*
     * Don't immediately hammer the
     * public provider with another request.
     */

    if (
      i <
      batches.length - 1
    ) {
      await sleep(
        WORD_BATCH_DELAY_MS
      );
    }
  }

  /*
   * Reconstruct the original word order.
   */

  return words.map(
    (word) => ({
      source: word,
      target:
        cache.get(word) ||
        word,
    })
  );
}

/*
 * ============================================
 * POST /api/translate
 * ============================================
 */

router.post(
  "/",
  async (req, res) => {
    try {
      const {
        text,
        source,
        target,
      } = req.body;

      /*
       * Validate text.
       */

      if (
        typeof text !==
          "string" ||
        !text.trim()
      ) {
        return res
          .status(400)
          .json({
            error:
              "Text is required.",
          });
      }

      /*
       * Normalize languages.
       */

      const normalizedSource =
        normalizeLanguage(
          source
        );

      const normalizedTarget =
        normalizeLanguage(
          target
        );

      if (
        !normalizedSource
      ) {
        return res
          .status(400)
          .json({
            error:
              "Unsupported source language. Supported languages: en, hi, ta, te, kn.",
          });
      }

      if (
        !normalizedTarget
      ) {
        return res
          .status(400)
          .json({
            error:
              "Unsupported target language. Supported languages: en, hi, ta, te, kn.",
          });
      }

      console.log(
        `Translation request: ${normalizedSource} -> ${normalizedTarget}`
      );

      /*
       * ========================================
       * Same language
       * ========================================
       */

      if (
        normalizedSource ===
        normalizedTarget
      ) {
        const tokens =
          tokenizeText(text);

        const words =
          tokens
            .filter(
              isWordToken
            )
            .map(
              (word) => ({
                source: word,
                target: word,
              })
            );

        return res.json({
          translation:
            text.trim(),

          words,

          source:
            normalizedSource,

          target:
            normalizedTarget,

          chunks: 1,
        });
      }

      /*
       * ========================================
       * Sentence translation
       * ========================================
       */

      const chunks =
        splitText(text);

      if (!chunks.length) {
        return res
          .status(400)
          .json({
            error:
              "No translatable text was found.",
          });
      }

      const translatedChunks =
        [];

      for (
        let i = 0;
        i < chunks.length;
        i++
      ) {
        const chunk =
          chunks[i];

        console.log(
          `Translating chunk ${
            i + 1
          }/${chunks.length} (${chunk.length} characters)`
        );

        const translated =
          await translateChunk(
            chunk,
            normalizedSource,
            normalizedTarget
          );

        translatedChunks.push(
          translated
        );

        /*
         * Small delay between sentence
         * chunks.
         *
         * This helps avoid immediately
         * triggering another 429.
         */

        if (
          i <
          chunks.length - 1
        ) {
          await sleep(300);
        }
      }

      const translation =
        translatedChunks.join(
          "\n"
        );

      /*
       * ========================================
       * Word-by-word translation
       * ========================================
       *
       * IMPORTANT:
       *
       * Failure here DOES NOT fail the
       * complete translation.
       */

      console.log(
        "Generating batched word-by-word translation..."
      );

      let words = [];

      try {
        words =
          await translateWords(
            text,
            normalizedSource,
            normalizedTarget
          );
      } catch (error) {
        console.error(
          "Word-by-word translation failed:",
          error.message
        );

        /*
         * Keep the main translation usable.
         */
        words = [];
      }

      /*
       * ========================================
       * Response
       * ========================================
       *
       * This shape is intentionally kept
       * compatible with your existing
       * App.tsx.
       */

      return res.json({
        translation,

        words,

        source:
          normalizedSource,

        target:
          normalizedTarget,

        chunks:
          chunks.length,
      });
    } catch (error) {
      console.error(
        "Translation error:",
        error
      );

      /*
       * Explicit 429 handling.
       */

      if (
        error?.message?.includes(
          "HTTP 429"
        ) ||
        error?.message?.includes(
          "rate-limiting"
        )
      ) {
        return res
          .status(429)
          .json({
            error:
              "The translation service is temporarily rate-limiting requests. Please wait 15–30 seconds and try again.",
          });
      }

      /*
       * Other errors.
       */

      return res
        .status(500)
        .json({
          error:
            error?.message ||
            "Translation failed.",
        });
    }
  }
);

export default router;