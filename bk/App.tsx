import {
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import { createWorker, PSM } from "tesseract.js";
import "./styles.css";

type Language = "eng" | "hin" | "tam" | "tel" | "kan";

type TranslationLanguage = "en" | "hi" | "ta" | "te" | "kn";

type WordTranslation = {
  source: string;
  target: string;
};

const OCR_LANGUAGES: {
  value: Language;
  label: string;
}[] = [
  { value: "eng", label: "English" },
  { value: "hin", label: "Hindi" },
  { value: "tam", label: "Tamil" },
  { value: "tel", label: "Telugu" },
  { value: "kan", label: "Kannada" },
];

const TRANSLATION_LANGUAGES: {
  value: TranslationLanguage;
  label: string;
}[] = [
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "ta", label: "Tamil" },
  { value: "te", label: "Telugu" },
  { value: "kn", label: "Kannada" },
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

const TRANSLATION_API = "/api/translate";

function App() {
  const [sourceLanguage, setSourceLanguage] =
    useState<Language>("hin");

  const [targetLanguage, setTargetLanguage] =
    useState<TranslationLanguage>("en");

  const [imageUrl, setImageUrl] = useState<string>("");

  const [ocrText, setOcrText] = useState<string>("");

  const [translation, setTranslation] =
    useState<string>("");

  const [wordTranslations, setWordTranslations] =
    useState<WordTranslation[]>([]);

  const [status, setStatus] = useState<string>("");

  const [isProcessing, setIsProcessing] =
    useState<boolean>(false);

  const [cameraOpen, setCameraOpen] =
    useState<boolean>(false);

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const videoRef =
    useRef<HTMLVideoElement | null>(null);

  const canvasRef =
    useRef<HTMLCanvasElement | null>(null);

  const streamRef =
    useRef<MediaStream | null>(null);

  /*
   * Cleanup camera when component unmounts.
   */
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  /*
   * Stop active camera stream.
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
   * Open device camera.
   */
  async function openCamera() {
    try {
      setStatus("Opening camera...");

      const stream =
        await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "environment",
          },
          audio: false,
        });

      streamRef.current = stream;

      setCameraOpen(true);

      /*
       * Wait for React to render the video element.
       */
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
      }, 100);

      setStatus(
        "Camera ready. Position the document and capture."
      );
    } catch (error) {
      console.error("Camera error:", error);

      setStatus(
        "Unable to access camera. Please check browser permissions."
      );
    }
  }

  /*
   * Capture image from camera.
   */
  async function captureImage() {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) {
      setStatus("Camera is not ready.");
      return;
    }

    if (
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      setStatus("Camera image is not ready yet.");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const context = canvas.getContext("2d");

    if (!context) {
      setStatus("Unable to capture camera image.");
      return;
    }

    context.drawImage(
      video,
      0,
      0,
      canvas.width,
      canvas.height
    );

    const blob = await new Promise<Blob | null>(
      (resolve) => {
        canvas.toBlob(
          (result) => resolve(result),
          "image/jpeg",
          0.92
        );
      }
    );

    if (!blob) {
      setStatus("Unable to create image.");
      return;
    }

    const file = new File(
      [blob],
      "camera-capture.jpg",
      {
        type: "image/jpeg",
      }
    );

    const url = URL.createObjectURL(blob);

    setImageUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }

      return url;
    });

    stopCamera();

    await performOCR(file);
  }

  /*
   * Handle uploaded image.
   */
  async function handleImageUpload(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!file.type.startsWith("image/")) {
      setStatus("Please select an image file.");
      return;
    }

    const url = URL.createObjectURL(file);

    setImageUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }

      return url;
    });

    await performOCR(file);

    /*
     * Allow selecting the same file again.
     */
    event.target.value = "";
  }

  /*
   * Translate OCR text through Node.js backend.
   */
  async function translateText(
    text: string
  ): Promise<string> {
    const cleanedText = text.trim();

    if (!cleanedText) {
      setTranslation("");
      setWordTranslations([]);
      return "";
    }

    const source =
      OCR_TO_TRANSLATION[sourceLanguage];

    const target = targetLanguage;

    /*
     * Same language:
     * no API call required.
     */
    if (source === target) {
      const words =
        cleanedText.match(
          /[\p{L}\p{M}\p{N}]+/gu
        ) || [];

      const sameLanguageWords =
        words.map((word) => ({
          source: word,
          target: word,
        }));

      setWordTranslations(
        sameLanguageWords
      );

      setTranslation(cleanedText);

      return cleanedText;
    }

    setStatus(
      "Translating detected text..."
    );

    const response = await fetch(
      TRANSLATION_API,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: cleanedText,
          source,
          target,
        }),
      }
    );

    let data: {
      translation?: string;
      words?: WordTranslation[];
      source?: TranslationLanguage;
      target?: TranslationLanguage;
      chunks?: number;
      error?: string;
    };

    try {
      data = await response.json();
    } catch {
      throw new Error(
        "Invalid response from translation server."
      );
    }

    if (!response.ok) {
      throw new Error(
        data.error ||
          "Translation request failed."
      );
    }

    setWordTranslations(
      data.words || []
    );

    setTranslation(
      data.translation || ""
    );

    return data.translation || "";
  }

  /*
   * Perform OCR using Tesseract.js.
   */
  async function performOCR(
    file: File
  ) {
    setIsProcessing(true);
    setStatus("Preparing OCR...");

    setOcrText("");
    setTranslation("");
    setWordTranslations([]);

    let worker:
      | Awaited<ReturnType<typeof createWorker>>
      | null = null;

    try {
      /*
       * Tesseract language code.
       */
      const language =
        sourceLanguage;

      setStatus(
        `Loading ${getLanguageLabel(
          sourceLanguage
        )} OCR model...`
      );

      worker =
        await createWorker(language);

      /*
       * Configure OCR segmentation.
       */
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.AUTO,
      });

      setStatus(
        "Reading text from image..."
      );

      const result =
        await worker.recognize(file);

      const detectedText =
        result.data.text.trim();

      setOcrText(detectedText);

      if (!detectedText) {
        setStatus(
          "No readable text was detected."
        );

        return;
      }

      setStatus(
        "Text detected. Translating..."
      );

      await translateText(
        detectedText
      );

      setStatus(
        "OCR and translation completed."
      );
    } catch (error) {
      console.error(
        "OCR/translation error:",
        error
      );

      const message =
        error instanceof Error
          ? error.message
          : "OCR failed.";

      setStatus(message);
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (error) {
          console.error(
            "Failed to terminate OCR worker:",
            error
          );
        }
      }

      setIsProcessing(false);
    }
  }

  /*
   * Trigger hidden file input.
   */
  function selectImage() {
    fileInputRef.current?.click();
  }

  /*
   * Clear everything.
   */
  function clearAll() {
    stopCamera();

    setOcrText("");
    setTranslation("");
    setWordTranslations([]);
    setStatus("");

    setImageUrl((previous) => {
      if (previous) {
        URL.revokeObjectURL(previous);
      }

      return "";
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  /*
   * Swap source and target language.
   */
  function swapLanguages() {
    const currentSource =
      OCR_TO_TRANSLATION[sourceLanguage];

    const newSourceLanguage =
      Object.entries(
        OCR_TO_TRANSLATION
      ).find(
        ([, translationCode]) =>
          translationCode ===
          targetLanguage
      )?.[0] as Language | undefined;

    if (newSourceLanguage) {
      setSourceLanguage(
        newSourceLanguage
      );
      setTargetLanguage(
        currentSource
      );

      /*
       * Clear old result because language
       * direction has changed.
       */
      setTranslation("");
      setWordTranslations([]);
    }
  }

  /*
   * Re-translate manually.
   */
  async function handleTranslate(
    event: FormEvent
  ) {
    event.preventDefault();

    if (!ocrText.trim()) {
      setStatus(
        "Please upload or capture an image first."
      );

      return;
    }

    setIsProcessing(true);

    try {
      await translateText(ocrText);

      setStatus(
        "Translation completed."
      );
    } catch (error) {
      console.error(
        "Translation error:",
        error
      );

      setStatus(
        error instanceof Error
          ? error.message
          : "Translation failed."
      );
    } finally {
      setIsProcessing(false);
    }
  }

  /*
   * Get display label for OCR language.
   */
  function getLanguageLabel(
    language: Language
  ) {
    return (
      OCR_LANGUAGES.find(
        (item) =>
          item.value === language
      )?.label || language
    );
  }

  /*
   * Get display label for target language.
   */
  function getTargetLanguageLabel(
    language: TranslationLanguage
  ) {
    return (
      TRANSLATION_LANGUAGES.find(
        (item) =>
          item.value === language
      )?.label || language
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>
            Multilingual Document Translator
          </h1>

          <p>
            Extract text from images and
            translate it into Indian languages.
          </p>
        </div>
      </header>

      <main className="container">
        {/* Controls */}
        <section className="card controls-card">
          <h2>Translation Settings</h2>

          <div className="language-controls">
            {/* Source Language */}
            <div className="field">
              <label htmlFor="source-language">
                Source Language
              </label>

              <select
                id="source-language"
                value={sourceLanguage}
                onChange={(event) => {
                  const language =
                    event.target.value as Language;

                  setSourceLanguage(language);

                  /*
                   * Automatically update target
                   * if both become the same.
                   */
                  const sourceCode =
                    OCR_TO_TRANSLATION[
                      language
                    ];

                  if (
                    sourceCode ===
                    targetLanguage
                  ) {
                    setTargetLanguage("en");
                  }

                  setTranslation("");
                  setWordTranslations([]);
                }}
                disabled={isProcessing}
              >
                {OCR_LANGUAGES.map(
                  (language) => (
                    <option
                      key={language.value}
                      value={language.value}
                    >
                      {language.label}
                    </option>
                  )
                )}
              </select>
            </div>

            {/* Swap */}
            <button
              type="button"
              className="swap-button"
              onClick={swapLanguages}
              disabled={isProcessing}
              title="Swap languages"
            >
              ⇄
            </button>

            {/* Target Language */}
            <div className="field">
              <label htmlFor="target-language">
                Target Language
              </label>

              <select
                id="target-language"
                value={targetLanguage}
                onChange={(event) => {
                  setTargetLanguage(
                    event.target
                      .value as TranslationLanguage
                  );

                  setTranslation("");
                  setWordTranslations([]);
                }}
                disabled={isProcessing}
              >
                {TRANSLATION_LANGUAGES.map(
                  (language) => (
                    <option
                      key={language.value}
                      value={language.value}
                    >
                      {language.label}
                    </option>
                  )
                )}
              </select>
            </div>
          </div>
        </section>

        {/* Upload / Camera */}
        <section className="card">
          <h2>Upload or Capture Image</h2>

          <div className="action-buttons">
            <button
              type="button"
              className="primary-button"
              onClick={selectImage}
              disabled={isProcessing}
            >
              Upload Image
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={
                cameraOpen
                  ? stopCamera
                  : openCamera
              }
              disabled={isProcessing}
            >
              {cameraOpen
                ? "Close Camera"
                : "Open Camera"}
            </button>

            <button
              type="button"
              className="clear-button"
              onClick={clearAll}
              disabled={
                isProcessing ||
                (!imageUrl &&
                  !ocrText &&
                  !translation)
              }
            >
              Clear
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            hidden
          />

          {/* Camera */}
          {cameraOpen && (
            <div className="camera-container">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="camera-video"
              />

              <div className="camera-actions">
                <button
                  type="button"
                  className="primary-button"
                  onClick={captureImage}
                  disabled={isProcessing}
                >
                  Capture Image
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={stopCamera}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          <canvas
            ref={canvasRef}
            hidden
          />

          {/* Image Preview */}
          {imageUrl && !cameraOpen && (
            <div className="image-preview">
              <h3>Image Preview</h3>

              <img
                src={imageUrl}
                alt="Uploaded document"
              />
            </div>
          )}
        </section>

        {/* Status */}
        {status && (
          <div className="status">
            {isProcessing && (
              <span className="spinner" />
            )}

            <span>{status}</span>
          </div>
        )}

        {/* Results */}
        <section className="results">
          {/* Detected Text */}
          <article className="card">
            <h2>Detected Text</h2>

            <textarea
              value={ocrText}
              readOnly
              placeholder="OCR text will appear here."
              rows={8}
            />

            {ocrText && (
              <div className="result-info">
                Detected from{" "}
                <strong>
                  {getLanguageLabel(
                    sourceLanguage
                  )}
                </strong>
              </div>
            )}
          </article>

          {/* Translation */}
          <article className="card">
            <h2>Translation</h2>

            <textarea
              value={translation}
              readOnly
              placeholder="Translated text will appear here."
              rows={8}
            />

            {translation && (
              <div className="result-info">
                Translated to{" "}
                <strong>
                  {getTargetLanguageLabel(
                    targetLanguage
                  )}
                </strong>
              </div>
            )}

            {/* Word-by-Word Translation */}
            {wordTranslations.length > 0 && (
              <div className="word-translation">
                <h3>Word-by-Word</h3>

                <div className="word-line">
                  {wordTranslations.map(
                    (item, index) => (
                      <span
                        className="word-pair"
                        key={`${item.source}-${index}`}
                      >
                        <span className="source-word">
                          {item.source}
                        </span>

                        <span className="arrow">
                          →
                        </span>

                        <span className="target-word">
                          {item.target}
                        </span>
                      </span>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Manual Translate */}
            {ocrText && (
              <form
                onSubmit={handleTranslate}
                className="translate-form"
              >
                <button
                  type="submit"
                  className="primary-button"
                  disabled={isProcessing}
                >
                  {isProcessing
                    ? "Translating..."
                    : "Translate Again"}
                </button>
              </form>
            )}
          </article>
        </section>
      </main>
    </div>
  );
}

export default App;