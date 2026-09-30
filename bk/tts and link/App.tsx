import {
  ChangeEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";
import { createWorker, PSM } from "tesseract.js";
import "./styles.css";

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

const OCR_LANGUAGES = [
  {
    value: "eng",
    label: "English",
  },
  {
    value: "hin",
    label: "Hindi",
  },
  {
    value: "tam",
    label: "Tamil",
  },
  {
    value: "tel",
    label: "Telugu",
  },
  {
    value: "kan",
    label: "Kannada",
  },
];

const TRANSLATION_LANGUAGES = [
  {
    value: "en",
    label: "English",
  },
  {
    value: "hi",
    label: "Hindi",
  },
  {
    value: "ta",
    label: "Tamil",
  },
  {
    value: "te",
    label: "Telugu",
  },
  {
    value: "kn",
    label: "Kannada",
  },
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

const TTS_LANGUAGES: Record<
  TranslationLanguage,
  string
> = {
  en: "en-IN",
  hi: "hi-IN",
  ta: "ta-IN",
  te: "te-IN",
  kn: "kn-IN",
};

const TRANSLATION_API = "/api/translate";

function getLanguageLabel(
  language: Language
): string {
  return (
    OCR_LANGUAGES.find(
      (item) => item.value === language
    )?.label || language
  );
}

function getTranslationLanguageLabel(
  language: TranslationLanguage
): string {
  return (
    TRANSLATION_LANGUAGES.find(
      (item) => item.value === language
    )?.label || language
  );
}

function App() {
  const [
    sourceLanguage,
    setSourceLanguage,
  ] = useState<Language>("hin");

  const [
    targetLanguage,
    setTargetLanguage,
  ] =
    useState<TranslationLanguage>("en");

  const [
    imageUrl,
    setImageUrl,
  ] = useState("");

  const [
    selectedFile,
    setSelectedFile,
  ] = useState<File | null>(null);

  const [
    ocrText,
    setOcrText,
  ] = useState("");

  const [
    translation,
    setTranslation,
  ] = useState("");

  const [
    wordTranslations,
    setWordTranslations,
  ] = useState<WordTranslation[]>([]);

  const [
    status,
    setStatus,
  ] = useState("");

  const [
    isProcessing,
    setIsProcessing,
  ] = useState(false);

  const [
    cameraOpen,
    setCameraOpen,
  ] = useState(false);

  const [
    isSourceSpeaking,
    setIsSourceSpeaking,
  ] = useState(false);

  const fileInputRef =
    useRef<HTMLInputElement | null>(null);

  const videoRef =
    useRef<HTMLVideoElement | null>(null);

  const canvasRef =
    useRef<HTMLCanvasElement | null>(null);

  const streamRef =
    useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      stopCamera();
    };
  }, []);

  function clearResults() {
    setOcrText("");
    setTranslation("");
    setWordTranslations([]);
  }

  function handleSourceLanguageChange(
    event: ChangeEvent<HTMLSelectElement>
  ) {
    const language =
      event.target.value as Language;

    setSourceLanguage(language);
    clearResults();
    setStatus("");
  }

  function handleTargetLanguageChange(
    event: ChangeEvent<HTMLSelectElement>
  ) {
    const language =
      event.target.value as TranslationLanguage;

    setTargetLanguage(language);
    setTranslation("");
    setWordTranslations([]);
    setStatus("");
  }

  function swapLanguages() {
    const currentSource =
      OCR_TO_TRANSLATION[sourceLanguage];

    const currentTarget = targetLanguage;

    const newSource = (
      Object.keys(OCR_TO_TRANSLATION) as Language[]
    ).find(
      (key) =>
        OCR_TO_TRANSLATION[key] ===
        currentTarget
    );

    if (newSource) {
      setSourceLanguage(newSource);
      setTargetLanguage(currentSource);
      clearResults();
      setStatus("");
    }
  }

  function handleFileChange(
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

    setSelectedFile(file);

    const url =
      URL.createObjectURL(file);

    setImageUrl(url);

    clearResults();

    setStatus(
      "Image loaded. Click Read & Translate."
    );
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function openCamera() {
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

      const stream =
        await navigator.mediaDevices.getUserMedia(
          {
            video: {
              facingMode: "environment",
            },
            audio: false,
          }
        );

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject =
          stream;

        await videoRef.current.play();
      }

      setCameraOpen(true);
      setStatus(
        "Camera is ready. Capture an image."
      );
    } catch (error) {
      console.error(
        "Camera error:",
        error
      );

      setStatus(
        "Unable to access the camera. Please allow camera permission."
      );
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current
        .getTracks()
        .forEach((track) => {
          track.stop();
        });

      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    setCameraOpen(false);
  }

  function captureImage() {
    const video =
      videoRef.current;

    const canvas =
      canvasRef.current;

    if (!video || !canvas) {
      return;
    }

    if (
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      setStatus(
        "Camera image is not ready yet."
      );
      return;
    }

    canvas.width =
      video.videoWidth;

    canvas.height =
      video.videoHeight;

    const context =
      canvas.getContext("2d");

    if (!context) {
      setStatus(
        "Unable to capture camera image."
      );
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
            "Unable to create image."
          );
          return;
        }

        const file =
          new File(
            [blob],
            `camera-${Date.now()}.jpg`,
            {
              type: "image/jpeg",
            }
          );

        setSelectedFile(file);

        const url =
          URL.createObjectURL(file);

        setImageUrl(url);

        clearResults();

        stopCamera();

        setStatus(
          "Image captured. Click Read & Translate."
        );
      },
      "image/jpeg",
      0.92
    );
  }

  async function handleReadAndTranslate() {
    if (!selectedFile) {
      setStatus(
        "Please upload or capture an image first."
      );
      return;
    }

    await performOCR(selectedFile);
  }

  async function performOCR(
    file: File
  ) {
    setIsProcessing(true);

    setStatus("Preparing OCR...");

    setOcrText("");
    setTranslation("");
    setWordTranslations([]);

    let worker:
      | Awaited<
          ReturnType<typeof createWorker>
        >
      | null = null;

    try {
      const language =
        sourceLanguage;

      setStatus(
        `Loading ${getLanguageLabel(
          sourceLanguage
        )} OCR model...`
      );

      worker =
        await createWorker(language);

      await worker.setParameters({
        tessedit_pageseg_mode:
          PSM.AUTO,
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

      setStatus(
        error instanceof Error
          ? error.message
          : "OCR failed."
      );
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

  async function translateText(
    text: string
  ): Promise<string> {
    const cleanedText =
      text.trim();

    if (!cleanedText) {
      setTranslation("");
      setWordTranslations([]);
      return "";
    }

    const source =
      OCR_TO_TRANSLATION[
        sourceLanguage
      ];

    const target =
      targetLanguage;

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
            text: cleanedText,
            source,
            target,
          }),
        }
      );

    let data: {
      translation?: string;
      words?: WordTranslation[];
      error?: string;
    };

    try {
      data =
        await response.json();
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

    return (
      data.translation || ""
    );
  }

  function speak(
    text: string,
    language: TranslationLanguage
  ) {
    if (!text.trim()) {
      return;
    }

    if (
      !("speechSynthesis" in window)
    ) {
      setStatus(
        "Text-to-speech is not supported by this browser."
      );
      return;
    }

    window.speechSynthesis.cancel();

    const utterance =
      new SpeechSynthesisUtterance(
        text
      );

    utterance.lang =
      TTS_LANGUAGES[language];

    utterance.rate = 0.85;
    utterance.pitch = 1;
    utterance.volume = 1;

    window.speechSynthesis.speak(
      utterance
    );
  }

  function speakSourceText() {
    if (!ocrText.trim()) {
      return;
    }

    if (
      !("speechSynthesis" in window)
    ) {
      setStatus(
        "Text-to-speech is not supported by this browser."
      );
      return;
    }

    window.speechSynthesis.cancel();

    const source =
      OCR_TO_TRANSLATION[
        sourceLanguage
      ];

    const utterance =
      new SpeechSynthesisUtterance(
        ocrText
      );

    utterance.lang =
      TTS_LANGUAGES[source];

    utterance.rate = 0.85;
    utterance.pitch = 1;
    utterance.volume = 1;

    utterance.onstart = () => {
      setIsSourceSpeaking(true);
    };

    utterance.onend = () => {
      setIsSourceSpeaking(false);
    };

    utterance.onerror = () => {
      setIsSourceSpeaking(false);
    };

    window.speechSynthesis.speak(
      utterance
    );
  }

  function stopSourceText() {
    if (
      !("speechSynthesis" in window)
    ) {
      return;
    }

    window.speechSynthesis.cancel();

    setIsSourceSpeaking(false);
  }

  function speakTranslation() {
    if (!translation.trim()) {
      return;
    }

    speak(
      translation,
      targetLanguage
    );
  }

  function speakWord(
    word: string,
    language: TranslationLanguage
  ) {
    speak(word, language);
  }

  function searchWordMeaning(
    word: string
  ) {
    const cleanWord =
      word.trim();

    if (!cleanWord) {
      return;
    }

    const searchUrl =
      `https://www.google.com/search?q=${encodeURIComponent(
        `${cleanWord} meaning`
      )}`;

    window.open(
      searchUrl,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function clearAll() {
    window.speechSynthesis?.cancel();

    setIsSourceSpeaking(false);

    setSelectedFile(null);
    setImageUrl("");

    clearResults();

    setStatus("");

    if (fileInputRef.current) {
      fileInputRef.current.value =
        "";
    }

    stopCamera();
  }

  function handleManualTranslate(
    event: FormEvent
  ) {
    event.preventDefault();

    if (!ocrText.trim()) {
      setStatus(
        "There is no detected text to translate."
      );
      return;
    }

    translateText(ocrText)
      .then(() => {
        setStatus(
          "Translation completed."
        );
      })
      .catch((error) => {
        console.error(
          "Translation error:",
          error
        );

        setStatus(
          error instanceof Error
            ? error.message
            : "Translation failed."
        );
      });
  }

  return (
    <div className="app">

      <header className="app-header">
        <h1>
          Multilingual Document Translator
        </h1>

        <p>
          Read, translate and listen to
          English, Hindi, Tamil, Telugu
          and Kannada text.
        </p>
      </header>

      <main className="container">

        {/* Language Selection */}

        <section className="card">

          <h2>
            Language Selection
          </h2>

          <div className="language-controls">

            <div className="field">

              <label htmlFor="source-language">
                Source Language
              </label>

              <select
                id="source-language"
                value={sourceLanguage}
                onChange={
                  handleSourceLanguageChange
                }
              >
                {OCR_LANGUAGES.map(
                  (language) => (
                    <option
                      key={language.value}
                      value={
                        language.value
                      }
                    >
                      {language.label}
                    </option>
                  )
                )}
              </select>

            </div>

            <button
              type="button"
              className="swap-button"
              onClick={
                swapLanguages
              }
              title="Swap languages"
            >
              ⇄
            </button>

            <div className="field">

              <label htmlFor="target-language">
                Target Language
              </label>

              <select
                id="target-language"
                value={targetLanguage}
                onChange={
                  handleTargetLanguageChange
                }
              >
                {TRANSLATION_LANGUAGES.map(
                  (language) => (
                    <option
                      key={language.value}
                      value={
                        language.value
                      }
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

          <h2>
            Upload or Capture Image
          </h2>

          <div className="action-buttons">

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={
                handleFileChange
              }
              hidden
            />

            <button
              type="button"
              className="primary-button"
              onClick={
                openFilePicker
              }
              disabled={isProcessing}
            >
              Upload Image
            </button>

            <button
              type="button"
              className="secondary-button"
              onClick={
                openCamera
              }
              disabled={
                isProcessing ||
                cameraOpen
              }
            >
              Open Camera
            </button>

            <button
              type="button"
              className="clear-button"
              onClick={
                clearAll
              }
              disabled={
                isProcessing
              }
            >
              Clear
            </button>

          </div>

          {cameraOpen && (
            <div className="camera-container">

              <video
                ref={videoRef}
                className="camera-video"
                playsInline
                muted
              />

              <div className="camera-actions">

                <button
                  type="button"
                  className="primary-button"
                  onClick={
                    captureImage
                  }
                >
                  Capture Image
                </button>

                <button
                  type="button"
                  className="secondary-button"
                  onClick={
                    stopCamera
                  }
                >
                  Close Camera
                </button>

              </div>

            </div>
          )}

          <canvas
            ref={canvasRef}
            hidden
          />

          {imageUrl && (
            <div className="image-preview">

              <h3>
                Image Preview
              </h3>

              <img
                src={imageUrl}
                alt="Selected document"
              />

            </div>
          )}

          {selectedFile && (
            <div className="read-translate-container">

              <button
                type="button"
                className="read-translate-button"
                onClick={
                  handleReadAndTranslate
                }
                disabled={
                  isProcessing
                }
              >
                {isProcessing
                  ? "Reading..."
                  : "▶ Read & Translate"}
              </button>

            </div>
          )}

        </section>

        {/* Status */}

        {status && (
          <div className="status">

            {isProcessing && (
              <span className="spinner" />
            )}

            <span>
              {status}
            </span>

          </div>
        )}

        {/* Results */}

        {(ocrText ||
          translation ||
          wordTranslations.length >
            0) && (

          <section className="results">

            {/* Detected Text */}

            <div className="card">

              <div className="result-heading">

                <h2>
                  Detected Text
                </h2>

                {ocrText && (
                  <div className="tts-controls">

                    <button
                      type="button"
                      className="tts-start-button"
                      onClick={
                        speakSourceText
                      }
                      disabled={
                        isSourceSpeaking
                      }
                    >
                      ▶ Start
                    </button>

                    <button
                      type="button"
                      className="tts-stop-button"
                      onClick={
                        stopSourceText
                      }
                      disabled={
                        !isSourceSpeaking
                      }
                    >
                      ■ Stop
                    </button>

                  </div>
                )}

              </div>

              <textarea
                value={ocrText}
                readOnly
                placeholder="OCR text will appear here."
                rows={14}
              />

              {ocrText && (
                <div className="result-info">

                  Source:
                  {" "}
                  {getLanguageLabel(
                    sourceLanguage
                  )}

                </div>
              )}

            </div>

            {/* Translation */}

            <div className="card">

              <div className="result-heading">

                <h2>
                  Translation
                </h2>

                {translation && (
                  <button
                    type="button"
                    className="tts-button"
                    onClick={
                      speakTranslation
                    }
                  >
                    🔊 Read
                  </button>
                )}

              </div>

              <textarea
                value={translation}
                readOnly
                placeholder="Translated text will appear here."
                rows={14}
              />

              {translation && (
                <div className="result-info">

                  Target:
                  {" "}
                  {getTranslationLanguageLabel(
                    targetLanguage
                  )}

                </div>
              )}

              {/* Word-by-word */}

              {wordTranslations.length >
                0 && (

                <div className="word-translation">

                  <h3>
                    Word-by-Word
                  </h3>

                  <p className="word-help">
                    Click a word to search
                    its meaning. Use 🔊
                    to hear it.
                  </p>

                  <div className="word-line">

                    {wordTranslations.map(
                      (
                        item,
                        index
                      ) => (

                        <div
                          className="word-pair"
                          key={`${item.source}-${index}`}
                        >

                          <button
                            type="button"
                            className="word-link"
                            onClick={() =>
                              searchWordMeaning(
                                item.source
                              )
                            }
                            title="Search meaning"
                          >
                            {
                              item.source
                            }
                          </button>

                          <button
                            type="button"
                            className="word-tts-button"
                            onClick={() =>
                              speakWord(
                                item.source,
                                OCR_TO_TRANSLATION[
                                  sourceLanguage
                                ]
                              )
                            }
                            title={`Listen to ${item.source}`}
                          >
                            🔊
                          </button>

                          <span className="arrow">
                            →
                          </span>

                          <button
                            type="button"
                            className="word-link target-word-link"
                            onClick={() =>
                              searchWordMeaning(
                                item.target
                              )
                            }
                            title="Search meaning"
                          >
                            {
                              item.target
                            }
                          </button>

                          <button
                            type="button"
                            className="word-tts-button"
                            onClick={() =>
                              speakWord(
                                item.target,
                                targetLanguage
                              )
                            }
                            title={`Listen to ${item.target}`}
                          >
                            🔊
                          </button>

                        </div>

                      )
                    )}

                  </div>

                </div>

              )}

            </div>

          </section>

        )}

        {/* Manual Translation */}

        {ocrText && (
          <section className="card">

            <h2>
              Re-translate Detected Text
            </h2>

            <form
              className="translate-form"
              onSubmit={
                handleManualTranslate
              }
            >

              <button
                type="submit"
                className="primary-button"
                disabled={
                  isProcessing
                }
              >
                Translate Again
              </button>

            </form>

          </section>
        )}

      </main>
    </div>
  );
}

export default App;