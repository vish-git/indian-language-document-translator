import {
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import { createWorker, PSM } from "tesseract.js";

type Language =
  | "eng"
  | "hin"
  | "tam"
  | "tel"
  | "kan";

type TranslationLanguage =
  | "en"
  | "hi"
  | "ta"
  | "te"
  | "kn";

type WordTranslation = {
  source: string;
  target: string;
};

const OCR_LANGUAGES: Record<Language, string> = {
  eng: "English",
  hin: "Hindi",
  tam: "Tamil",
  tel: "Telugu",
  kan: "Kannada",
};

const TRANSLATION_LANGUAGES: {
  code: TranslationLanguage;
  name: string;
}[] = [
  { code: "en", name: "English" },
  { code: "hi", name: "Hindi" },
  { code: "ta", name: "Tamil" },
  { code: "te", name: "Telugu" },
  { code: "kn", name: "Kannada" },
];

const OCR_TO_TRANSLATION: Record<
  Language,
  TranslationLanguage
> = {
  eng: "en",
  hin: "hi",
  tam: "ta",
  tel: "te",
  kan: "kn",
};

/*
 * Vite proxy forwards:
 *
 * /api/translate
 *
 * to:
 *
 * http://localhost:8000/api/translate
 */
const TRANSLATION_API = "/api/translate";

export default function AppCOPY() {
  const [sourceLanguage, setSourceLanguage] =
    useState<Language>("hin");

  const [targetLanguage, setTargetLanguage] =
    useState<TranslationLanguage>("en");

  const [imageUrl, setImageUrl] =
    useState<string>("");

  const [ocrText, setOcrText] =
    useState<string>("");

  const [translation, setTranslation] =
    useState<string>("");

  /*
   * NEW:
   *
   * Stores the word-by-word translation
   * returned by the Node.js backend.
   */
  const [wordTranslations, setWordTranslations] =
    useState<WordTranslation[]>([]);

  const [status, setStatus] =
    useState<string>(
      "Capture or upload an image."
    );

  const [isProcessing, setIsProcessing] =
    useState(false);

  const [cameraOpen, setCameraOpen] =
    useState(false);

  const videoRef =
    useRef<HTMLVideoElement>(null);

  const streamRef =
    useRef<MediaStream | null>(null);

  const fileInputRef =
    useRef<HTMLInputElement>(null);

  /*
   * Cleanup camera when component is unmounted.
   */
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current
          .getTracks()
          .forEach((track) => track.stop());

        streamRef.current = null;
      }

      setCameraOpen(false);
    };
  }, []);

  /*
   * Cleanup image URL when it changes.
   */
  useEffect(() => {
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [imageUrl]);

  /*
   * Open camera.
   */
  async function startCamera() {
    try {
      if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
      ) {
        setStatus(
          "Camera is not supported by this browser."
        );

        return;
      }

      setStatus(
        "Requesting camera permission..."
      );

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: {
              ideal: "environment",
            },
          },
          audio: false,
        });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;

        await videoRef.current.play();
      }

      setCameraOpen(true);

      setStatus(
        "Point the camera at the text and capture it."
      );
    } catch (error) {
      console.error(error);

      setStatus(
        "Camera access was blocked. You can upload an image instead."
      );
    }
  }

  /*
   * Stop camera.
   */
  function stopCamera() {
    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track) => track.stop());

      streamRef.current = null;
    }

    setCameraOpen(false);
  }

  /*
   * Capture image from camera.
   */
  function captureImage() {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    if (!video.videoWidth) {
      setStatus(
        "Camera is not ready yet."
      );

      return;
    }

    const canvas =
      document.createElement("canvas");

    canvas.width =
      video.videoWidth;

    canvas.height =
      video.videoHeight;

    const context =
      canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setStatus(
            "Could not capture the image."
          );

          return;
        }

        const url =
          URL.createObjectURL(blob);

        setImageUrl(url);

        setOcrText("");
        setTranslation("");

        /*
         * Clear previous word translations.
         */
        setWordTranslations([]);

        setStatus(
          "Image captured. Click Read Text & Translate."
        );
      },
      "image/jpeg",
      0.92
    );

    stopCamera();
  }

  /*
   * Upload image.
   */
  function handleImageUpload(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file =
      event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus(
        "Please select an image file."
      );

      return;
    }

    const url =
      URL.createObjectURL(file);

    setImageUrl(url);

    setOcrText("");
    setTranslation("");

    /*
     * Clear previous word translations.
     */
    setWordTranslations([]);

    setStatus(
      "Image uploaded. Click Read Text & Translate."
    );

    event.target.value = "";
  }

  /*
   * Translate OCR text using Node.js backend.
   *
   * Backend response:
   *
   * {
   *   translation: "...",
   *   words: [
   *     {
   *       source: "...",
   *       target: "..."
   *     }
   *   ]
   * }
   */
  async function translateText(
    text: string
  ): Promise<string> {
    const sourceLanguageCode =
      OCR_TO_TRANSLATION[
        sourceLanguage
      ];

    /*
     * If source and target are the same,
     * no API call is necessary.
     */
    if (
      sourceLanguageCode ===
      targetLanguage
    ) {
      setStatus(
        "Source and target languages are the same."
      );

      /*
       * Generate simple word pairs locally.
       */
      const words = text
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => ({
          source: word,
          target: word,
        }));

      setWordTranslations(words);

      return text;
    }

    const targetName =
      TRANSLATION_LANGUAGES.find(
        (language) =>
          language.code ===
          targetLanguage
      )?.name ?? targetLanguage;

    setStatus(
      `Translating to ${targetName}...`
    );

    /*
     * Send OCR text to Node.js.
     */
    const response =
      await fetch(
        TRANSLATION_API,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
          },

          body: JSON.stringify({
            text,
            source:
              sourceLanguageCode,
            target:
              targetLanguage,
          }),
        }
      );

    /*
     * Backend response type.
     */
    let data: {
      translation?: string;

      words?: WordTranslation[];

      source?: TranslationLanguage;

      target?: TranslationLanguage;

      chunks?: number;

      error?: string;
    };

    try {
      data =
        await response.json();
    } catch {
      throw new Error(
        "Backend returned an invalid response."
      );
    }

    /*
     * Handle backend error.
     */
    if (!response.ok) {
      throw new Error(
        data.error ||
          `Translation failed with HTTP ${response.status}`
      );
    }

    /*
     * Natural translation is required.
     */
    if (!data.translation) {
      throw new Error(
        "Backend returned no translation."
      );
    }

    /*
     * IMPORTANT:
     *
     * Save the word-by-word result.
     */
    setWordTranslations(
      data.words || []
    );

    return data.translation;
  }

  /*
   * OCR + Translation.
   */
  async function performOCR() {
    if (!imageUrl) {
      setStatus(
        "Please capture or upload an image first."
      );

      return;
    }

    setIsProcessing(true);

    /*
     * Clear previous results.
     */
    setOcrText("");
    setTranslation("");
    setWordTranslations([]);

    const languageName =
      OCR_LANGUAGES[
        sourceLanguage
      ];

    let worker:
      Awaited<
        ReturnType<
          typeof createWorker
        >
      > | null = null;

    try {
      /*
       * Load Tesseract language data.
       */
      setStatus(
        `Loading ${languageName} OCR data...`
      );

      worker =
        await createWorker(
          sourceLanguage
        );

      /*
       * Configure OCR.
       */
      await worker.setParameters({
        tessedit_pageseg_mode:
          PSM.AUTO,
      });

      setStatus(
        `Reading ${languageName} text...`
      );

      /*
       * Perform OCR.
       */
      const result =
        await worker.recognize(
          imageUrl
        );

      const detectedText =
        result.data.text.trim();

      console.log(
        "OCR result:",
        detectedText
      );

      /*
       * Show OCR result.
       */
      setOcrText(
        detectedText
      );

      if (!detectedText) {
        setStatus(
          "No text detected. Try a clearer image with better lighting."
        );

        return;
      }

      /*
       * Translate OCR text.
       *
       * This now returns the natural translation
       * while also populating wordTranslations.
       */
      const translatedText =
        await translateText(
          detectedText
        );

      setTranslation(
        translatedText
      );

      setStatus(
        "OCR, translation and word meanings completed successfully."
      );
    } catch (error) {
      console.error(
        "OCR / Translation error:",
        error
      );

      setStatus(
        error instanceof Error
          ? error.message
          : "OCR or translation failed."
      );
    } finally {
      /*
       * Always terminate Tesseract worker.
       */
      if (worker) {
        try {
          await worker.terminate();
        } catch {
          // Ignore cleanup errors.
        }
      }

      setIsProcessing(false);
    }
  }

  return (
    <main className="app">

      {/* Header */}

      <header className="header">

        <div>
          <h1>
            Camera Translator
          </h1>

          <p>
            Translate text from images
            using Tesseract OCR.
          </p>
        </div>

        <div className="badge">
          OCR + Translation
        </div>

      </header>

      {/* Language Controls */}

      <section className="card controls">

        <div className="field">

          <label htmlFor="source-language">
            Source language
          </label>

          <select
            id="source-language"
            value={sourceLanguage}
            disabled={isProcessing}
            onChange={(event) =>
              setSourceLanguage(
                event.target
                  .value as Language
              )
            }
          >
            {Object.entries(
              OCR_LANGUAGES
            ).map(
              ([
                code,
                name,
              ]) => (
                <option
                  key={code}
                  value={code}
                >
                  {name}
                </option>
              )
            )}
          </select>

        </div>

        <div className="field">

          <label htmlFor="target-language">
            Translate to
          </label>

          <select
            id="target-language"
            value={targetLanguage}
            disabled={isProcessing}
            onChange={(event) =>
              setTargetLanguage(
                event.target
                  .value as TranslationLanguage
              )
            }
          >
            {TRANSLATION_LANGUAGES.map(
              (language) => (
                <option
                  key={language.code}
                  value={language.code}
                >
                  {language.name}
                </option>
              )
            )}
          </select>

        </div>

      </section>

      {/* Camera / Upload */}

      <section className="card">

        <div className="actions">

          <button
            type="button"
            disabled={isProcessing}
            onClick={startCamera}
          >
            📷 Open Camera
          </button>

          <button
            type="button"
            disabled={isProcessing}
            onClick={() =>
              fileInputRef.current?.click()
            }
          >
            🖼️ Upload Image
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={
              handleImageUpload
            }
            hidden
          />

        </div>

        {/* Camera */}

        {cameraOpen && (
          <div className="camera">

            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
            />

            <div className="camera-actions">

              <button
                type="button"
                onClick={
                  captureImage
                }
              >
                Capture
              </button>

              <button
                type="button"
                className="secondary"
                onClick={
                  stopCamera
                }
              >
                Close
              </button>

            </div>

          </div>
        )}

        {/* Image Preview */}

        {imageUrl && (
          <div className="preview">

            <img
              src={imageUrl}
              alt="Captured or uploaded text"
            />

          </div>
        )}

        {/* OCR + Translation */}

        <button
          type="button"
          className="primary"
          disabled={
            !imageUrl ||
            isProcessing
          }
          onClick={
            performOCR
          }
        >
          {isProcessing
            ? "Reading / Translating..."
            : "Read Text & Translate"}
        </button>

        <div className="status">
          {status}
        </div>

      </section>

      {/* Results */}

      <section className="results">

        {/* Detected Text */}

        <article className="card">

          <h2>
            Detected Text
          </h2>

          <textarea
            value={ocrText}
            readOnly
            placeholder="OCR text will appear here."
          />

        </article>

        {/* Natural Translation */}

        <article className="card">

          <h2>
            Translation
          </h2>

          <textarea
            value={translation}
            readOnly
            placeholder="Translated text will appear here."
          />

        </article>

      </section>

      {/* Word-by-Word Translation */}

      {wordTranslations.length > 0 && (
        <section className="card word-translation-section">

          <h2>
            Word-by-Word Meaning
          </h2>

          <p className="word-translation-help">
            Literal meaning of each detected
            word. This may differ from the
            natural sentence translation above.
          </p>

          <div className="word-translation-table">

            <div className="word-row word-header">
              <div>
                Source
              </div>

              <div>
                Meaning
              </div>
            </div>

            {wordTranslations.map(
              (item, index) => (
                <div
                  className="word-row"
                  key={`${item.source}-${index}`}
                >

                  <div className="source-word">
                    {item.source}
                  </div>

                  <div className="target-word">
                    {item.target}
                  </div>

                </div>
              )
            )}

          </div>

        </section>
      )}

      <footer>
        OCR is performed locally in
        the browser using Tesseract.js.
        Translation is handled by the
        Node.js backend.
      </footer>

    </main>
  );
}