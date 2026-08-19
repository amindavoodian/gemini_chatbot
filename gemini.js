/**
Gemini API Engine
Features:
Dynamic model fetching
Multi-API key fallback cycling
Model priority fallback on quota / errors
Audio, Image, Video, File base64 encoding
Real-time SSE Word-by-Word Streaming
Context Caching integration
Isolated Translation Runner
*/
const GeminiAPI = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  
  defaultModels: [
    "gemini-2.5-flash",
    "gemini-2.5-pro",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-pro"
  ],

  getApiKeys() {
    const raw = localStorage.getItem("gemini_api_keys") || "";
    return raw
      .split(/[\n,]+/)
      .map(k => k.trim())
      .filter(k => k.length > 0);
  },

  getModelPriority() {
    const stored = localStorage.getItem("gemini_model_priority");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return this.defaultModels;
  },

  saveModelPriority(list) {
    localStorage.setItem("gemini_model_priority", JSON.stringify(list));
  },

  /**
  Fetch available models from Gemini endpoint using first working API key
  */
  async fetchAvailableModels() {
    const keys = this.getApiKeys();
    if (keys.length === 0) return this.defaultModels;

    for (const key of keys) {
      try {
        const res = await fetch(`${this.baseUrl}/models?key=${key}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.models && Array.isArray(data.models)) {
          const valid = data.models
            .filter(m => m.supportedGenerationMethods?.includes("generateContent"))
            .map(m => m.name.replace("models/", ""));
          if (valid.length > 0) return valid;
        }
      } catch (e) {
        console.warn("Error fetching models with key:", e);
      }
    }
    return this.defaultModels;
  },

  /**
  Convert Browser File into Base64 for inlineData payload
  */
  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = reader.result;
        const base64 = res.split(",")[1];
        resolve({
          mimeType: file.type || "application/octet-stream",
          data: base64
        });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
  Check / create Gemini Context Cache if history is large
  */
  async tryCreateContextCache(apiKey, model, contents) {
    const isCachingEnabled = localStorage.getItem("gemini_caching_enabled") !== "false";
    if (!isCachingEnabled || contents.length < 6) return null;

    try {
      const cachePayload = {
        model: `models/${model}`,
        contents: contents.slice(0, -1),
        ttl: "300s"
      };

      const res = await fetch(`${this.baseUrl}/cachedContents?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cachePayload)
      });

      if (res.ok) {
        const data = await res.json();
        return data.name;
      }
    } catch (err) {
      console.warn("Context caching skipped or not supported for prompt size:", err);
    }
    return null;
  },

  /**
  Execute Regular Chat Generation with Multi-Key & Multi-Model Fallbacks
  */
  async generate({
    selectedModel,
    historyMessages = [],
    newPrompt = "",
    attachedFiles = [],
    isStreaming = true,
    onChunk = () => {},
    onFallbackNotice = () => {}
  }) {
    const keys = this.getApiKeys();
    if (keys.length === 0) {
      throw new Error("No Gemini API Key provided. Please add one in Settings.");
    }

    const priorityList = this.getModelPriority();
    const modelsToTry = [
      selectedModel,
      ...priorityList.filter(m => m !== selectedModel)
    ];

    // Format files into inlineData parts
    const fileParts = [];
    for (const f of attachedFiles) {
      const b64 = await this.fileToBase64(f);
      fileParts.push({
        inlineData: {
          mimeType: b64.mimeType,
          data: b64.data
        }
      });
    }

    // Build Gemini contents array exclusively from clean conversational messages
    const contents = [];
    for (const msg of historyMessages) {
      if (msg.content && msg.content.trim()) {
        contents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msg.content }]
        });
      }
    }

    // Append latest prompt + attachments
    const currentParts = [];
    if (newPrompt.trim()) currentParts.push({ text: newPrompt });
    fileParts.forEach(fp => currentParts.push(fp));

    contents.push({
      role: "user",
      parts: currentParts
    });

    let lastError = null;

    // Fallback Loop: Models
    for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
      const currentModel = modelsToTry[mIdx];

      // Fallback Loop: Keys
      for (let kIdx = 0; kIdx < keys.length; kIdx++) {
        const currentKey = keys[kIdx];

        if (mIdx > 0 || kIdx > 0) {
          onFallbackNotice(`Switching to Model: ${currentModel} (Key #${kIdx + 1})...`);
        }

        try {
          const cacheName = await this.tryCreateContextCache(currentKey, currentModel, contents);
          const requestPayload = {
            contents: cacheName ? [contents[contents.length - 1]] : contents,
            generationConfig: {
              temperature: 0.7,
              topP: 0.95
            }
          };
          if (cacheName) {
            requestPayload.cachedContent = cacheName;
          }

          if (isStreaming) {
            console.log(`[GeminiAPI] Streaming requested with model: ${currentModel} on Key #${kIdx + 1}`);
            const endpoint = `${this.baseUrl}/models/${currentModel}:streamGenerateContent?alt=sse&key=${currentKey}`;
            const res = await fetch(endpoint, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Accept": "text/event-stream"
              },
              body: JSON.stringify(requestPayload)
            });

            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}));
              throw new Error(errBody.error?.message || `HTTP ${res.status}`);
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";
            let fullAccumulatedText = "";

            const processSSELine = (line) => {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith(":")) return;
              if (trimmed.startsWith("data:")) {
                const jsonStr = trimmed.slice(5).trim();
                if (!jsonStr || jsonStr === "[DONE]") return;
                try {
                  const parsed = JSON.parse(jsonStr);
                  const candidate = parsed.candidates?.[0];
                  if (candidate?.content?.parts && Array.isArray(candidate.content.parts)) {
                    for (const part of candidate.content.parts) {
                      if (part && typeof part.text === "string" && !part.thought) {
                        fullAccumulatedText += part.text;
                        onChunk(part.text, fullAccumulatedText);
                      }
                    }
                  }
                } catch (e) {
                  console.warn("[GeminiAPI] SSE JSON parse warning:", e, jsonStr);
                }
              }
            };

            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                if (buffer.trim()) {
                  const remainingLines = buffer.split(/\r?\n/);
                  for (const rLine of remainingLines) {
                    processSSELine(rLine);
                  }
                }
                break;
              }

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split(/\r?\n/);
              buffer = lines.pop() || "";

              for (const line of lines) {
                processSSELine(line);
              }
            }

            if (!fullAccumulatedText.trim()) {
              throw new Error("Empty response received during stream.");
            }

            console.log(`[GeminiAPI] Streaming completed successfully (${fullAccumulatedText.length} characters).`);
            return {
              text: fullAccumulatedText,
              modelUsed: currentModel
            };

          } else {
            console.log(`[GeminiAPI] Unary generation requested with model: ${currentModel}`);
            const endpoint = `${this.baseUrl}/models/${currentModel}:generateContent?key=${currentKey}`;
            const res = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(requestPayload)
            });

            if (!res.ok) {
              const errBody = await res.json().catch(() => ({}));
              throw new Error(errBody.error?.message || `HTTP ${res.status}`);
            }

            const data = await res.json();
            let replyText = "";
            const candidate = data.candidates?.[0];
            if (candidate?.content?.parts && Array.isArray(candidate.content.parts)) {
              for (const part of candidate.content.parts) {
                if (part && typeof part.text === "string" && !part.thought) {
                  replyText += part.text;
                }
              }
            }

            if (!replyText.trim()) {
              throw new Error("No response generated by model.");
            }

            onChunk(replyText, replyText);

            return {
              text: replyText,
              modelUsed: currentModel
            };
          }

        } catch (err) {
          console.warn(`Attempt failed with Model ${currentModel} on Key #${kIdx + 1}:`, err.message);
          lastError = err;
        }
      }
    }

    throw new Error(`All models and API keys failed. Last error: ${lastError?.message || "Unknown error"}`);
  },

  /**
  Translate Text to Fluent Persian (Farsi) Outside the Chat History Flow
  */
  async translateToFarsi(textToTranslate, activeModel = "gemini-2.5-flash") {
    const keys = this.getApiKeys();
    if (keys.length === 0) {
      throw new Error("No API key available for translation.");
    }

    const prompt = `You are a master English-to-Persian translator and editor. Translate and rewrite the following text into fluent, natural, professional, and grammatically impeccable Persian (Farsi / فارسی).

Rules:
1. Preserve all markdown formatting, lists, tables, and code blocks precisely.
2. Translate technical terms naturally while retaining essential English terms in parentheses if necessary.
3. Output ONLY the translated Persian content directly without any introductory or concluding remarks.

Text to translate:
${textToTranslate}`;

    const priorityList = this.getModelPriority();
    const modelsToTry = [
      activeModel,
      ...priorityList.filter(m => m !== activeModel)
    ];

    for (const model of modelsToTry) {
      for (const key of keys) {
        try {
          const endpoint = `${this.baseUrl}/models/${model}:generateContent?key=${key}`;
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.3 }
            })
          });

          if (!res.ok) continue;
          const data = await res.json();
          const translatedText = data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (translatedText) return translatedText.trim();
        } catch (e) {
          console.warn(`Translation attempt failed on ${model}:`, e);
        }
      }
    }

    throw new Error("Could not translate the message. Please check your API keys or connection.");
  }
};