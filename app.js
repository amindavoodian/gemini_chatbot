/**
Main Application Controller
Connects UI, Gemini Fallback, Turso DB, Supabase Storage, Farsi Translation, & Font Scaling
*/
(function() {
  // DOM Elements
  const appLayout = document.getElementById("appLayout");
  const sidebar = document.getElementById("sidebar");
  const sidebarBackdrop = document.getElementById("sidebarBackdrop");
  const btnToggleSidebar = document.getElementById("btnToggleSidebar");
  const btnCloseSidebar = document.getElementById("btnCloseSidebar");
  const btnNewChat = document.getElementById("btnNewChat");
  const btnHeaderNewChat = document.getElementById("btnHeaderNewChat");
  const historyList = document.getElementById("historyList");
  const historyEmpty = document.getElementById("historyEmpty");
  const btnClearAllHistory = document.getElementById("btnClearAllHistory");
  const modelSelect = document.getElementById("modelSelect");
  const statusBadge = document.getElementById("statusBadge");
  const chatContainer = document.getElementById("chatContainer");
  const welcomeScreen = document.getElementById("welcomeScreen");
  const messagesList = document.getElementById("messagesList");
  const chatTextarea = document.getElementById("chatTextarea");
  const btnSend = document.getElementById("btnSend");
  const btnAttach = document.getElementById("btnAttach");
  const fileInput = document.getElementById("fileInput");
  const attachmentPreviews = document.getElementById("attachmentPreviews");
  const notificationBanner = document.getElementById("notificationBanner");

  // Font Size Scaler Controls
  const btnFontDecrease = document.getElementById("btnFontDecrease");
  const btnFontIncrease = document.getElementById("btnFontIncrease");
  const btnFontReset = document.getElementById("btnFontReset");
  const fontSizeIndicator = document.getElementById("fontSizeIndicator");

  // Theme & RTL Controls
  const btnThemeToggle = document.getElementById("btnThemeToggle");
  const themeToggleText = document.getElementById("themeToggleText");
  const themeToggleIcon = document.getElementById("themeToggleIcon");
  const settingThemeToggle = document.getElementById("settingThemeToggle");
  const btnRTLToggle = document.getElementById("btnRTLToggle");
  const btnHeaderRTL = document.getElementById("btnHeaderRTL");
  const rtlToggleText = document.getElementById("rtlToggleText");

  // Settings Modal Elements
  const settingsModal = document.getElementById("settingsModal");
  const btnOpenSettings = document.getElementById("btnOpenSettings");
  const btnCloseSettings = document.getElementById("btnCloseSettings");
  const btnCancelSettings = document.getElementById("btnCancelSettings");
  const btnSaveSettings = document.getElementById("btnSaveSettings");
  const settingApiKeys = document.getElementById("settingApiKeys");
  const settingStreaming = document.getElementById("settingStreaming");
  const settingCaching = document.getElementById("settingCaching");
  const priorityListContainer = document.getElementById("priorityListContainer");
  const btnRefreshModels = document.getElementById("btnRefreshModels");

  // State
  let currentConversationId = null;
  let currentMessages = [];
  let attachedFiles = [];
  let isGenerating = false;
  let availableModels = [];

  // Setup Markdown parser with Highlight.js
  if (window.marked) {
    marked.setOptions({
      highlight: function(code, lang) {
        try {
          if (window.hljs) {
            const validLang = lang && hljs.getLanguage(lang) ? lang : "plaintext";
            return hljs.highlight(code, { language: validLang, ignoreIllegals: true }).value;
          }
        } catch (e) {
          console.warn("Markdown highlight warning:", e);
        }
        return code;
      },
      breaks: true
    });
  }

  // --- INITIALIZATION ---
  async function initApp() {
    // 1. Initialize Theme
    const savedTheme = localStorage.getItem("chat_theme") || "dark";
    applyTheme(savedTheme);

    // 2. Initialize Direction
    const savedDir = localStorage.getItem("chat_direction") || "ltr";
    applyDirection(savedDir);

    // 3. Initialize Font Size
    const savedFontSize = parseInt(localStorage.getItem("chat_font_size") || "15", 10);
    applyFontSize(savedFontSize);

    // 4. Initialize Turso DB & Supabase
    try {
      await TursoDB.initDB();
      SupabaseStorage.init();
      await loadConversationsList();
    } catch (e) {
      console.warn("Storage init notice:", e);
    }

    // 5. Load & Populate Live Models from Google
    await refreshModelsList();

    // 6. Setup Suggestion Cards
    document.querySelectorAll(".suggestion-card").forEach(card => {
      card.addEventListener("click", () => {
        chatTextarea.value = card.getAttribute("data-prompt");
        autoResizeTextarea();
        handleSendMessage();
      });
    });

    // 7. Open Settings if no API key exists
    if (GeminiAPI.getApiKeys().length === 0) {
      openSettingsModal();
    }
  }

  // --- FONT SIZE CONTROLLER (+ and -) ---
  function applyFontSize(size) {
    const clampedSize = Math.max(12, Math.min(22, size));
    document.documentElement.style.setProperty("--chat-font-size", clampedSize + "px");
    localStorage.setItem("chat_font_size", clampedSize);
    if (fontSizeIndicator) {
      fontSizeIndicator.textContent = clampedSize + "px";
    }
  }

  btnFontDecrease?.addEventListener("click", () => {
    const current = parseInt(localStorage.getItem("chat_font_size") || "15", 10);
    applyFontSize(current - 1);
  });

  btnFontIncrease?.addEventListener("click", () => {
    const current = parseInt(localStorage.getItem("chat_font_size") || "15", 10);
    applyFontSize(current + 1);
  });

  btnFontReset?.addEventListener("click", () => {
    applyFontSize(15);
  });

  // --- THEME CONTROLLER ---
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("chat_theme", theme);

    const isLight = theme === "light";
    if (themeToggleText) {
      themeToggleText.textContent = isLight ? "Dark Mode" : "Light Mode";
    }
    if (themeToggleIcon) {
      themeToggleIcon.className = isLight ? "fa-solid fa-moon" : "fa-solid fa-sun";
    }
    if (settingThemeToggle) {
      settingThemeToggle.checked = isLight;
    }
  }

  function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
    const nextTheme = currentTheme === "light" ? "dark" : "light";
    applyTheme(nextTheme);
  }

  // --- RTL / LTR DIRECTION TOGGLE ---
  function applyDirection(dir) {
    document.documentElement.setAttribute("dir", dir);
    localStorage.setItem("chat_direction", dir);
    if (rtlToggleText) {
      rtlToggleText.textContent = dir === "rtl" ? "LTR Mode" : "RTL Mode";
    }
  }

  function toggleDirection() {
    const current = document.documentElement.getAttribute("dir") || "ltr";
    const next = current === "rtl" ? "ltr" : "rtl";
    applyDirection(next);
  }

  // --- MODEL MANAGEMENT & PRIORITY (ONLINE LIVE SYNC) ---
  async function refreshModelsList(isManualReload = false) {
    modelSelect.innerHTML = "<option disabled selected>Syncing models from Google...</option>";
    availableModels = await GeminiAPI.fetchAvailableModels();

    const storedPriority = GeminiAPI.getModelPriority();
    
    // Filter stored priority to keep user ordering for valid models
    const validStoredPriority = storedPriority.filter(m => availableModels.includes(m));
    const finalPriority = isManualReload
      ? availableModels
      : Array.from(new Set([...validStoredPriority, ...availableModels]));

    GeminiAPI.saveModelPriority(finalPriority);

    const prevSelected = modelSelect.value;
    modelSelect.innerHTML = "";
    finalPriority.forEach(model => {
      const opt = document.createElement("option");
      opt.value = model;
      opt.textContent = model;
      modelSelect.appendChild(opt);
    });

    if (prevSelected && finalPriority.includes(prevSelected)) {
      modelSelect.value = prevSelected;
    } else if (finalPriority.length > 0) {
      modelSelect.value = finalPriority[0];
    }
    renderPrioritySettingsList();
  }

  // --- DRAG & TOUCH REORDER PRIORITY LIST ---
  function renderPrioritySettingsList() {
    const list = GeminiAPI.getModelPriority();
    priorityListContainer.innerHTML = "";

    list.forEach((model, index) => {
      const row = document.createElement("div");
      row.className = "priority-item";
      row.setAttribute("draggable", "true");
      row.setAttribute("data-idx", index);
      row.innerHTML = `
        <div class="priority-item-left">
          <i class="fa-solid fa-grip-vertical priority-grab-handle" title="Grab and drag to reorder"></i>
          <span><strong>#${index + 1}</strong> ${escapeHtml(model)}</span>
        </div>
        <div class="priority-item-controls">
          <button class="priority-btn btn-up" data-idx="${index}" title="Move Up" ${index === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
          <button class="priority-btn btn-down" data-idx="${index}" title="Move Down" ${index === list.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
        </div>
      `;
      priorityListContainer.appendChild(row);
    });

    // Up / Down Buttons
    priorityListContainer.querySelectorAll(".btn-up").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute("data-idx"));
        if (idx > 0) {
          const curList = GeminiAPI.getModelPriority();
          const temp = curList[idx - 1];
          curList[idx - 1] = curList[idx];
          curList[idx] = temp;
          GeminiAPI.saveModelPriority(curList);
          renderPrioritySettingsList();
        }
      });
    });

    priorityListContainer.querySelectorAll(".btn-down").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.getAttribute("data-idx"));
        const curList = GeminiAPI.getModelPriority();
        if (idx < curList.length - 1) {
          const temp = curList[idx + 1];
          curList[idx + 1] = curList[idx];
          curList[idx] = temp;
          GeminiAPI.saveModelPriority(curList);
          renderPrioritySettingsList();
        }
      });
    });

    // Pointer & Touch Reorder
    let dragSrcIdx = null;
    const items = priorityListContainer.querySelectorAll(".priority-item");

    items.forEach(item => {
      item.addEventListener("dragstart", (e) => {
        dragSrcIdx = parseInt(item.getAttribute("data-idx"));
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragSrcIdx);
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const targetIdx = parseInt(item.getAttribute("data-idx"));
        if (dragSrcIdx !== null && targetIdx !== dragSrcIdx) {
          item.classList.add("drag-over");
        }
      });

      item.addEventListener("dragleave", () => item.classList.remove("drag-over"));

      item.addEventListener("drop", (e) => {
        e.preventDefault();
        item.classList.remove("drag-over");
        const targetIdx = parseInt(item.getAttribute("data-idx"));
        if (dragSrcIdx !== null && targetIdx !== dragSrcIdx) {
          const curList = GeminiAPI.getModelPriority();
          const moved = curList.splice(dragSrcIdx, 1)[0];
          curList.splice(targetIdx, 0, moved);
          GeminiAPI.saveModelPriority(curList);
          renderPrioritySettingsList();
        }
      });

      item.addEventListener("dragend", () => {
        items.forEach(el => el.classList.remove("dragging", "drag-over"));
        dragSrcIdx = null;
      });

      // Mobile Touch Drag Support
      const grabHandle = item.querySelector(".priority-grab-handle");
      let currentTouchTarget = null;

      grabHandle.addEventListener("touchstart", () => {
        dragSrcIdx = parseInt(item.getAttribute("data-idx"));
        item.classList.add("dragging");
      }, { passive: false });

      grabHandle.addEventListener("touchmove", (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const elemUnderTouch = document.elementFromPoint(touch.clientX, touch.clientY);
        const targetItem = elemUnderTouch ? elemUnderTouch.closest(".priority-item") : null;

        items.forEach(el => el.classList.remove("drag-over"));
        if (targetItem && targetItem !== item) {
          targetItem.classList.add("drag-over");
          currentTouchTarget = targetItem;
        }
      }, { passive: false });

      grabHandle.addEventListener("touchend", () => {
        item.classList.remove("dragging");
        items.forEach(el => el.classList.remove("drag-over"));
        if (currentTouchTarget && dragSrcIdx !== null) {
          const targetIdx = parseInt(currentTouchTarget.getAttribute("data-idx"));
          if (!isNaN(targetIdx) && targetIdx !== dragSrcIdx) {
            const curList = GeminiAPI.getModelPriority();
            const moved = curList.splice(dragSrcIdx, 1)[0];
            curList.splice(targetIdx, 0, moved);
            GeminiAPI.saveModelPriority(curList);
            renderPrioritySettingsList();
          }
        }
        dragSrcIdx = null;
        currentTouchTarget = null;
      });
    });
  }

  // --- CONVERSATION & HISTORY CONTROLLERS ---
  async function loadConversationsList() {
    try {
      const convs = await TursoDB.getConversations();
      historyList.innerHTML = "";
      if (!convs || convs.length === 0) {
        historyEmpty.style.display = "block";
        historyList.appendChild(historyEmpty);
        return;
      }
      historyEmpty.style.display = "none";

      convs.forEach(c => {
        const item = document.createElement("div");
        item.className = `history-item ${c.id === currentConversationId ? "active" : ""}`;
        item.setAttribute("data-id", c.id);
        item.innerHTML = `
          <span class="history-title">${escapeHtml(c.title || "Untitled Conversation")}</span>
          <div class="history-actions">
            <button class="history-btn-del" title="Delete chat"><i class="fa-solid fa-trash"></i></button>
          </div>
        `;

        item.addEventListener("click", (e) => {
          if (e.target.closest(".history-btn-del")) return;
          openConversation(c.id);
          closeSidebarMobile();
        });

        item.querySelector(".history-btn-del").addEventListener("click", async (e) => {
          e.stopPropagation();
          if (confirm("Delete this conversation and its uploaded files?")) {
            await deleteSingleConversation(c.id);
          }
        });

        historyList.appendChild(item);
      });
    } catch (e) {
      console.warn("Failed loading conversations from Turso:", e);
    }
  }

  async function openConversation(convId) {
    currentConversationId = convId;
    welcomeScreen.style.display = "none";
    messagesList.innerHTML = "";

    document.querySelectorAll(".history-item").forEach(el => {
      el.classList.toggle("active", el.getAttribute("data-id") === convId);
    });

    try {
      const msgs = await TursoDB.getMessages(convId);
      currentMessages = msgs || [];
      currentMessages.forEach(msg => {
        let parsedFiles = [];
        if (msg.files) {
          if (typeof msg.files === "string") {
            try {
              parsedFiles = JSON.parse(msg.files);
            } catch (e) {
              parsedFiles = [];
            }
          } else if (Array.isArray(msg.files)) {
            parsedFiles = msg.files;
          }
        }
        appendMessageUI(msg.role, msg.content, parsedFiles, msg.model_used, false, msg.id, msg.translation || "");
      });
      scrollToBottom();
    } catch (e) {
      console.error("Failed loading messages:", e);
    }
  }

  function startNewConversation() {
    currentConversationId = null;
    currentMessages = [];
    messagesList.innerHTML = "";
    welcomeScreen.style.display = "flex";
    attachedFiles = [];
    renderAttachmentPreviews();
    document.querySelectorAll(".history-item").forEach(el => el.classList.remove("active"));
    closeSidebarMobile();
    chatTextarea.focus();
  }

  async function deleteSingleConversation(convId) {
    try {
      await SupabaseStorage.deleteConversationFiles(convId);
      await TursoDB.deleteConversation(convId);

      if (currentConversationId === convId) {
        startNewConversation();
      }
      await loadConversationsList();
    } catch (e) {
      alert("Error deleting conversation: " + e.message);
    }
  }

  async function clearAllHistory() {
    if (!confirm("Are you sure you want to permanently delete all conversations and uploaded media?")) return;
    try {
      await SupabaseStorage.clearAllStorage();
      await TursoDB.clearAllHistory();
      startNewConversation();
      await loadConversationsList();
    } catch (e) {
      alert("Error clearing history: " + e.message);
    }
  }

  // --- MESSAGE UI RENDERING ---
  function appendMessageUI(role, content, files = [], modelUsed = "", isStreaming = false, messageId = "", existingTranslation = "") {
    welcomeScreen.style.display = "none";

    const row = document.createElement("div");
    row.className = `message-row ${role === "user" ? "user" : "model"}`;
    if (messageId) row.setAttribute("data-msg-id", messageId);

    // Build Files/Media HTML
    let filesHtml = "";
    if (files && Array.isArray(files) && files.length > 0) {
      filesHtml = `<div class="message-attachments">`;
      files.forEach(f => {
        if (!f || !f.url) return;
        const fileType = (f.type || "").toLowerCase();
        const fileName = (f.name || "attachment").toLowerCase();
        const safeName = escapeHtml(f.name || "attachment");
        const safeUrl = f.url;

        const isImg = fileType.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico)$/i.test(fileName);
        const isVideo = fileType.startsWith("video/") || /\.(mp4|webm|ogg|mov|mkv)$/i.test(fileName);
        const isAudio = fileType.startsWith("audio/") || /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(fileName);

        if (isImg) {
          filesHtml += `
            <div class="attachment-image-card">
              <img src="${safeUrl}" alt="${safeName}" loading="lazy" />
              <a href="${safeUrl}" download="${safeName}" target="_blank" rel="noopener noreferrer" class="btn-attachment-download" title="Download ${safeName}">
                <i class="fa-solid fa-arrow-down"></i>
              </a>
            </div>
          `;
        } else if (isVideo) {
          filesHtml += `
            <div class="attachment-video-card">
              <video src="${safeUrl}" controls></video>
              <a href="${safeUrl}" download="${safeName}" target="_blank" rel="noopener noreferrer" class="btn-attachment-download" title="Download ${safeName}">
                <i class="fa-solid fa-arrow-down"></i>
              </a>
            </div>
          `;
        } else if (isAudio) {
          filesHtml += `
            <div class="attachment-audio-card">
              <div class="attachment-audio-header">
                <i class="fa-solid fa-music"></i>
                <span class="attachment-name">${safeName}</span>
                <a href="${safeUrl}" download="${safeName}" target="_blank" rel="noopener noreferrer" class="btn-attachment-download-inline" title="Download ${safeName}">
                  <i class="fa-solid fa-arrow-down"></i>
                </a>
              </div>
              <audio src="${safeUrl}" controls></audio>
            </div>
          `;
        } else {
          filesHtml += `
            <div class="attachment-file-card">
              <div class="attachment-file-info">
                <i class="fa-solid ${getFileIcon(f.type || f.name)}"></i>
                <span class="attachment-name">${safeName}</span>
              </div>
              <a href="${safeUrl}" download="${safeName}" target="_blank" rel="noopener noreferrer" class="btn-attachment-download-inline" title="Download ${safeName}">
                <i class="fa-solid fa-arrow-down"></i>
              </a>
            </div>
          `;
        }
      });
      filesHtml += `</div>`;
    }

    // Model Header at top
    if (role === "model") {
      const headerNode = document.createElement("div");
      headerNode.className = "model-row-header";
      headerNode.innerHTML = `
        <div class="model-avatar-compact"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
        <span class="model-name-label">Gemini</span>
      `;
      row.appendChild(headerNode);
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    let renderedText = "";
    if (role === "model") {
      try {
        renderedText = content ? DOMPurify.sanitize(marked.parse(content)) : "";
      } catch (e) {
        renderedText = escapeHtml(content);
      }
    } else {
      renderedText = escapeHtml(content);
    }

    // Model Action & Attribution Footer strictly underneath answer
    let actionFooterHtml = "";
    if (role === "model") {
      actionFooterHtml = `
        <div class="model-action-bar">
          <div class="model-action-left">
            <button class="btn-translate-farsi" title="Rewrite & translate this answer into Persian">
              <i class="fa-solid fa-language"></i>
              <span>Translate to Farsi</span>
            </button>
          </div>
          <div class="model-attribution">${modelUsed ? `<i class="fa-solid fa-sparkles"></i> ${escapeHtml(modelUsed)}` : ""}</div>
        </div>
      `;
    }

    bubble.innerHTML = `
      ${filesHtml}
      <div class="message-content">${renderedText}</div>
      ${actionFooterHtml}
      <div class="translation-container-slot"></div>
    `;

    setupCodeBlockHeaders(bubble);

    // Render existing translation if present
    if (existingTranslation) {
      const slot = bubble.querySelector(".translation-container-slot");
      if (slot) renderTranslationBox(slot, existingTranslation);
    }

    // Translate to Farsi button listener
    if (role === "model") {
      const btnTranslate = bubble.querySelector(".btn-translate-farsi");
      if (btnTranslate) {
        btnTranslate.addEventListener("click", () => handleTranslateClick(bubble, content, messageId, btnTranslate));
      }
    }

    row.appendChild(bubble);
    messagesList.appendChild(row);
    scrollToBottom();

    return { row, bubble };
  }

  function setupCodeBlockHeaders(container) {
    container.querySelectorAll("pre").forEach(pre => {
      if (pre.querySelector(".code-header")) return;
      const code = pre.querySelector("code");
      const header = document.createElement("div");
      header.className = "code-header";
      header.innerHTML = `
        <span>Code</span>
        <button class="btn-copy-code"><i class="fa-regular fa-copy"></i> Copy</button>
      `;
      header.querySelector(".btn-copy-code").addEventListener("click", () => {
        navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
        const btn = header.querySelector(".btn-copy-code");
        btn.innerHTML = `<i class="fa-solid fa-check"></i> Copied!`;
        setTimeout(() => {
          btn.innerHTML = `<i class="fa-regular fa-copy"></i> Copy`;
        }, 2000);
      });
      pre.insertBefore(header, pre.firstChild);
    });
  }

  // --- TRANSLATE TO FARSI ACTION ---
  async function handleTranslateClick(bubble, rawContent, msgId, btnTranslate) {
    const slot = bubble.querySelector(".translation-container-slot");
    if (!slot || !rawContent) return;

    if (slot.innerHTML.trim().length > 0) {
      slot.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    const originalBtnHtml = btnTranslate.innerHTML;
    btnTranslate.classList.add("loading");
    btnTranslate.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Translating...</span>`;

    try {
      const activeModel = modelSelect.value || "gemini-2.5-flash";
      const farsiTranslation = await GeminiAPI.translateToFarsi(rawContent, activeModel);

      // Render Persian translation
      renderTranslationBox(slot, farsiTranslation);

      // Persist in Turso Database
      if (msgId) {
        await TursoDB.updateMessageTranslation(msgId, farsiTranslation);
      }

      btnTranslate.innerHTML = originalBtnHtml;
    } catch (err) {
      alert("Translation failed: " + err.message);
      btnTranslate.innerHTML = originalBtnHtml;
    } finally {
      btnTranslate.classList.remove("loading");
      scrollToBottom();
    }
  }

  function renderTranslationBox(slotElement, translatedMarkdown) {
    let sanitizedHtml = "";
    try {
      sanitizedHtml = DOMPurify.sanitize(marked.parse(translatedMarkdown || ""));
    } catch (e) {
      sanitizedHtml = escapeHtml(translatedMarkdown || "");
    }

    slotElement.innerHTML = `
      <div class="message-translation-box">
        <div class="translation-header">
          <span class="badge-translated"><i class="fa-solid fa-check"></i> ترجمه شده</span>
          <button class="btn-copy-translation" title="کپی ترجمه"><i class="fa-regular fa-copy"></i> کپی</button>
        </div>
        <div class="translation-content">${sanitizedHtml}</div>
      </div>
    `;

    setupCodeBlockHeaders(slotElement);

    const copyBtn = slotElement.querySelector(".btn-copy-translation");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const textToCopy = slotElement.querySelector(".translation-content").innerText;
        navigator.clipboard.writeText(textToCopy);
        copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> کپی شد!`;
        setTimeout(() => {
          copyBtn.innerHTML = `<i class="fa-regular fa-copy"></i> کپی`;
        }, 2000);
      });
    }
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // --- SEND MESSAGE & GEMINI STREAMING WORKFLOW ---
  async function handleSendMessage() {
    const prompt = chatTextarea.value.trim();
    if ((!prompt && attachedFiles.length === 0) || isGenerating) return;

    const selectedModel = modelSelect.value || "gemini-2.5-flash";
    const isStreaming = localStorage.getItem("gemini_streaming_enabled") !== "false";

    // 1. Ensure Conversation exists in Turso
    const now = Date.now();
    if (!currentConversationId) {
      currentConversationId = "conv_" + now;
      const title = prompt ? prompt.slice(0, 32) : (attachedFiles[0]?.name || "Media Chat");
      await TursoDB.saveConversation(currentConversationId, title, now, now);
      await loadConversationsList();
    } else {
      await TursoDB.updateConversationTime(currentConversationId, now);
    }

    // 2. Upload attachments to Supabase Storage
    const uploadedMediaList = [];
    const filesToPassToGemini = [...attachedFiles];

    if (attachedFiles.length > 0) {
      statusBadge.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Uploading media...`;
      statusBadge.classList.add("busy");
      
      for (const file of attachedFiles) {
        const mediaObj = await SupabaseStorage.uploadFile(currentConversationId, file);
        uploadedMediaList.push(mediaObj);
      }
    }

    // 3. Render user message in UI and persist to Turso
    const userMsgId = "msg_" + Date.now();
    const filesJson = JSON.stringify(uploadedMediaList);

    appendMessageUI("user", prompt, uploadedMediaList, "", false, userMsgId);
    await TursoDB.saveMessage(userMsgId, currentConversationId, "user", prompt, "", filesJson, now, "");

    currentMessages.push({ role: "user", content: prompt, files: filesJson, id: userMsgId });

    // Clear input & attachments
    chatTextarea.value = "";
    attachedFiles = [];
    renderAttachmentPreviews();
    autoResizeTextarea();

    // 4. Prepare UI for AI response
    isGenerating = true;
    btnSend.disabled = true;
    statusBadge.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Generating...`;
    statusBadge.classList.add("busy");
    hideNotification();

    const aiMsgId = "msg_" + Date.now();
    const aiMessagePlaceholder = appendMessageUI("model", "", [], "", true, aiMsgId);
    const contentContainer = aiMessagePlaceholder.bubble.querySelector(".message-content");

    let finalAssistantText = "";
    let actualModelUsed = selectedModel;

    try {
      const cleanHistoryForGemini = currentMessages.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content
      }));

      const result = await GeminiAPI.generate({
        selectedModel: selectedModel,
        historyMessages: cleanHistoryForGemini,
        newPrompt: prompt,
        attachedFiles: filesToPassToGemini,
        isStreaming: isStreaming,
        onChunk: (chunk, fullText) => {
          finalAssistantText = fullText;
          try {
            contentContainer.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
          } catch (e) {
            contentContainer.textContent = fullText;
          }
          setupCodeBlockHeaders(contentContainer);
          scrollToBottom();
        },
        onFallbackNotice: (msg) => {
          showNotification(msg, "warning");
        }
      });

      finalAssistantText = result.text;
      actualModelUsed = result.modelUsed;

      // Update muted attribution under the answer section
      const attr = aiMessagePlaceholder.bubble.querySelector(".model-attribution");
      if (attr && actualModelUsed) {
        attr.innerHTML = `<i class="fa-solid fa-sparkles"></i> ${escapeHtml(actualModelUsed)}`;
      }

      // Setup translation button click
      const btnTranslate = aiMessagePlaceholder.bubble.querySelector(".btn-translate-farsi");
      if (btnTranslate) {
        btnTranslate.addEventListener("click", () => handleTranslateClick(aiMessagePlaceholder.bubble, finalAssistantText, aiMsgId, btnTranslate));
      }

      await TursoDB.saveMessage(aiMsgId, currentConversationId, "model", finalAssistantText, actualModelUsed, "[]", Date.now(), "");
      currentMessages.push({ role: "model", content: finalAssistantText, model_used: actualModelUsed, id: aiMsgId });

    } catch (err) {
      contentContainer.innerHTML = `<span style="color: var(--danger-color);"><i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(err.message)}</span>`;
    } finally {
      isGenerating = false;
      btnSend.disabled = false;
      statusBadge.innerHTML = `<i class="fa-solid fa-circle"></i> Ready`;
      statusBadge.classList.remove("busy");
      scrollToBottom();
    }
  }

  // --- ATTACHMENT HANDLERS ---
  btnAttach.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    const files = Array.from(e.target.files);
    attachedFiles.push(...files);
    renderAttachmentPreviews();
    fileInput.value = "";
  });

  function renderAttachmentPreviews() {
    attachmentPreviews.innerHTML = "";
    attachedFiles.forEach((file, index) => {
      const chip = document.createElement("div");
      chip.className = "attachment-chip";
      chip.innerHTML = `<i class="fa-solid ${getFileIcon(file.type || file.name)}"></i> <span>${escapeHtml(file.name)}</span> <button class="attachment-chip-remove" data-idx="${index}"><i class="fa-solid fa-xmark"></i></button>`;
      chip.querySelector(".attachment-chip-remove").addEventListener("click", () => {
        attachedFiles.splice(index, 1);
        renderAttachmentPreviews();
      });
      attachmentPreviews.appendChild(chip);
    });
    toggleSendButton();
  }

  function getFileIcon(typeOrName = "") {
    const str = String(typeOrName).toLowerCase();
    if (str.includes("image") || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(str)) return "fa-file-image";
    if (str.includes("video") || /\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(str)) return "fa-file-video";
    if (str.includes("audio") || /\.(mp3|wav|ogg|aac|m4a|flac)$/i.test(str)) return "fa-file-audio";
    if (str.includes("pdf") || /\.pdf$/i.test(str)) return "fa-file-pdf";
    return "fa-file-lines";
  }

  // --- TEXTAREA & AUTO-EXPAND ---
  chatTextarea.addEventListener("input", () => {
    autoResizeTextarea();
    toggleSendButton();
  });

  chatTextarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  function autoResizeTextarea() {
    chatTextarea.style.height = "auto";
    chatTextarea.style.height = Math.min(chatTextarea.scrollHeight, 200) + "px";
  }

  function toggleSendButton() {
    btnSend.disabled = chatTextarea.value.trim().length === 0 && attachedFiles.length === 0;
  }

  // --- NOTIFICATION BANNER ---
  function showNotification(msg, type = "warning") {
    notificationBanner.className = `notification-banner ${type}`;
    notificationBanner.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> <span>${escapeHtml(msg)}</span>`;
    notificationBanner.style.display = "flex";
  }

  function hideNotification() {
    notificationBanner.style.display = "none";
  }

  // --- SIDEBAR TOGGLES ---
  btnToggleSidebar.addEventListener("click", () => {
    if (window.innerWidth <= 768) {
      sidebar.classList.toggle("open");
      sidebarBackdrop.classList.toggle("show");
    } else {
      sidebar.classList.toggle("collapsed");
    }
  });

  btnCloseSidebar.addEventListener("click", closeSidebarMobile);
  sidebarBackdrop.addEventListener("click", closeSidebarMobile);

  function closeSidebarMobile() {
    sidebar.classList.remove("open");
    sidebarBackdrop.classList.remove("show");
  }

  // --- SETTINGS MODAL INTERACTIONS ---
  btnOpenSettings.addEventListener("click", openSettingsModal);
  btnCloseSettings.addEventListener("click", closeSettingsModal);
  btnCancelSettings.addEventListener("click", closeSettingsModal);

  function openSettingsModal() {
    settingApiKeys.value = GeminiAPI.getApiKeys().join("\n");
    settingStreaming.checked = localStorage.getItem("gemini_streaming_enabled") !== "false";
    settingCaching.checked = localStorage.getItem("gemini_caching_enabled") !== "false";
    settingThemeToggle.checked = (document.documentElement.getAttribute("data-theme") || "dark") === "light";
    renderPrioritySettingsList();
    settingsModal.classList.add("open");
  }

  function closeSettingsModal() {
    settingsModal.classList.remove("open");
  }

  btnSaveSettings.addEventListener("click", async () => {
    localStorage.setItem("gemini_api_keys", settingApiKeys.value.trim());
    localStorage.setItem("gemini_streaming_enabled", settingStreaming.checked ? "true" : "false");
    localStorage.setItem("gemini_caching_enabled", settingCaching.checked ? "true" : "false");
    applyTheme(settingThemeToggle.checked ? "light" : "dark");
    closeSettingsModal();
    await refreshModelsList(true);
  });

  btnRefreshModels.addEventListener("click", async () => {
    localStorage.setItem("gemini_api_keys", settingApiKeys.value.trim());
    await refreshModelsList(true);
  });

  // --- GENERAL BUTTON LISTENERS ---
  btnNewChat.addEventListener("click", startNewConversation);
  btnHeaderNewChat.addEventListener("click", startNewConversation);
  btnClearAllHistory.addEventListener("click", clearAllHistory);
  btnThemeToggle.addEventListener("click", toggleTheme);
  btnRTLToggle.addEventListener("click", toggleDirection);
  btnHeaderRTL.addEventListener("click", toggleDirection);
  btnSend.addEventListener("click", handleSendMessage);

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  document.addEventListener("DOMContentLoaded", initApp);
})();
