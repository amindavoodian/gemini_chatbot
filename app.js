/**
Main Application Controller (SPA Mode)
Optimized for client-side single page navigation, instant AI response prioritization,
voice recording, background synchronization, and minimal UI feedback windows.
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
  const modelSelectWrapper = document.getElementById("modelSelectWrapper");
  const statusBadge = document.getElementById("statusBadge");
  const chatContainer = document.getElementById("chatContainer");
  const welcomeScreen = document.getElementById("welcomeScreen");
  const messagesList = document.getElementById("messagesList");
  const chatTextarea = document.getElementById("chatTextarea");
  const btnSend = document.getElementById("btnSend");
  const btnAttach = document.getElementById("btnAttach");
  const btnMic = document.getElementById("btnMic");
  const fileInput = document.getElementById("fileInput");
  const attachmentPreviews = document.getElementById("attachmentPreviews");
  const notificationBanner = document.getElementById("notificationBanner");
  const notificationBannerContent = document.getElementById("notificationBannerContent");
  const btnCloseNotification = document.getElementById("btnCloseNotification");

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
  const btnTogglePrioritySection = document.getElementById("btnTogglePrioritySection");
  const priorityCollapsibleContent = document.getElementById("priorityCollapsibleContent");
  const priorityAccordionIcon = document.getElementById("priorityAccordionIcon");

  // Minimal Deletion Process Modal Elements
  const deleteModal = document.getElementById("deleteModal");
  const deleteModalTitle = document.getElementById("deleteModalTitle");
  const deleteModalMessage = document.getElementById("deleteModalMessage");
  const deleteConfirmView = document.getElementById("deleteConfirmView");
  const deleteProcessView = document.getElementById("deleteProcessView");
  const deleteCompleteView = document.getElementById("deleteCompleteView");
  const deleteStatusText = document.getElementById("deleteStatusText");
  const deleteCompleteText = document.getElementById("deleteCompleteText");
  const btnCloseDeleteModal = document.getElementById("btnCloseDeleteModal");
  const btnCancelDelete = document.getElementById("btnCancelDelete");
  const btnConfirmDelete = document.getElementById("btnConfirmDelete");
  const stepStorage = document.getElementById("stepStorage");
  const stepDatabase = document.getElementById("stepDatabase");
  const stepCache = document.getElementById("stepCache");

  // LocalStorage Cache & Sync Constants
  const CACHE_KEY_RECENT_CONVS = "gemini_cached_recent_convs_v1";
  const CACHE_KEY_MSG_PREFIX = "gemini_cached_msgs_v1_";
  const CACHE_KEY_SYNC_QUEUE = "gemini_pending_sync_queue_v2";
  const MAX_CACHED_CONVS = 5;

  // State
  let currentConversationId = null;
  let currentMessages = [];
  let attachedFiles = [];
  let isGenerating = false;
  let availableModels = [];
  let lockedModel = localStorage.getItem("gemini_locked_model") || null;
  let notificationTimer = null;
  let pendingDeleteAction = null;

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

  // =========================================================================
  // SPA ROUTER (Single Page Application Hash Router)
  // =========================================================================
  function navigateTo(route, pushState = true) {
    if (pushState) {
      if (window.location.hash !== route) {
        window.location.hash = route;
      }
    }
  }

  function handleRoute() {
    const hash = window.location.hash || "#/";

    if (hash === "#/settings") {
      openSettingsModal(false);
      return;
    } else {
      closeSettingsModal(false);
    }

    if (hash.startsWith("#/chat/")) {
      const convId = hash.replace("#/chat/", "").trim();
      if (convId && convId !== currentConversationId) {
        openConversation(convId, false);
      }
    } else if (hash === "#/new" || hash === "#/" || hash === "") {
      if (currentConversationId !== null) {
        startNewConversation(false);
      }
    }
  }

  window.addEventListener("hashchange", handleRoute);

  // =========================================================================
  // BACKGROUND SYNC ENGINE (Persistent Offline Queue for Turso & Supabase)
  // =========================================================================
  const SyncQueue = {
    isProcessing: false,

    getTasks() {
      try {
        const raw = localStorage.getItem(CACHE_KEY_SYNC_QUEUE);
        return raw ? JSON.parse(raw) : [];
      } catch (e) {
        return [];
      }
    },

    saveTasks(tasks) {
      try {
        localStorage.setItem(CACHE_KEY_SYNC_QUEUE, JSON.stringify(tasks));
      } catch (e) {
        console.warn("Sync queue storage notice:", e);
      }
    },

    enqueue(task) {
      const tasks = this.getTasks();
      tasks.push({
        id: "task_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        createdAt: Date.now(),
        ...task
      });
      this.saveTasks(tasks);

      if (!isGenerating) {
        setTimeout(() => this.process(), 50);
      }
    },

    removeTask(taskId) {
      const tasks = this.getTasks().filter(t => t.id !== taskId);
      this.saveTasks(tasks);
    },

    clearTasksForConversation(convId) {
      const tasks = this.getTasks().filter(t => t.conversationId !== convId);
      this.saveTasks(tasks);
    },

    clearAll() {
      localStorage.removeItem(CACHE_KEY_SYNC_QUEUE);
    },

    async process() {
      if (this.isProcessing || isGenerating) return;
      const tasks = this.getTasks();
      if (tasks.length === 0) return;

      this.isProcessing = true;

      try {
        for (const task of tasks) {
          if (isGenerating) break;

          try {
            switch (task.type) {
              case "SAVE_CONV":
                await TursoDB.saveConversation(task.conversationId, task.title, task.createdAt, task.updatedAt);
                break;

              case "UPDATE_CONV_TIME":
                await TursoDB.updateConversationTime(task.conversationId, task.updatedAt);
                break;

              case "SAVE_USER_MSG": {
                let finalFiles = task.files || [];
                if (finalFiles.length > 0 && finalFiles.some(f => f.dataUrl && !f.uploaded)) {
                  const uploadedList = [];
                  for (const f of finalFiles) {
                    if (f.uploaded && f.url) {
                      uploadedList.push(f);
                    } else {
                      const uploaded = await SupabaseStorage.uploadFile(task.conversationId, f);
                      uploadedList.push({ ...uploaded, uploaded: true });
                    }
                  }
                  finalFiles = uploadedList;
                }

                const filesJson = JSON.stringify(finalFiles);
                await TursoDB.saveMessage(
                  task.messageId,
                  task.conversationId,
                  "user",
                  task.content || "",
                  "",
                  filesJson,
                  task.createdAt,
                  ""
                );
                break;
              }

              case "SAVE_MODEL_MSG":
                await TursoDB.saveMessage(
                  task.messageId,
                  task.conversationId,
                  "model",
                  task.content || "",
                  task.modelUsed || "",
                  task.filesJson || "[]",
                  task.createdAt,
                  task.translation || ""
                );
                break;

              case "UPDATE_TRANSLATION":
                await TursoDB.updateMessageTranslation(task.messageId, task.translation);
                break;
            }

            this.removeTask(task.id);
          } catch (taskErr) {
            console.warn("Background sync task deferred:", task.type, taskErr);
            break;
          }
        }
      } finally {
        this.isProcessing = false;
      }
    }
  };

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

    // 4. Instant Load from Local Cache (0ms)
    renderCachedConversations();

    // 5. Initialize Turso DB, Supabase & Process Background Sync Queue
    try {
      await TursoDB.initDB();
      SupabaseStorage.init();
      await loadConversationsList();
      SyncQueue.process();
    } catch (e) {
      console.warn("Storage background init notice:", e);
    }

    // 6. Load & Populate Models
    await refreshModelsList();

    // 7. Setup Suggestion Cards
    document.querySelectorAll(".suggestion-card").forEach(card => {
      card.addEventListener("click", () => {
        chatTextarea.value = card.getAttribute("data-prompt");
        autoResizeTextarea();
        handleSendMessage();
      });
    });

    // 8. Setup Notification Close
    btnCloseNotification?.addEventListener("click", hideNotification);

    // 9. Initial SPA Route Handling
    handleRoute();

    // 10. Open Settings if no API key exists
    if (GeminiAPI.getApiKeys().length === 0) {
      openSettingsModal();
    }
  }

  // --- LOCALSTORAGE 5-CONVERSATION CACHING SYSTEM ---
  function getCachedConversations() {
    try {
      const raw = localStorage.getItem(CACHE_KEY_RECENT_CONVS);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function saveCachedConversations(convs) {
    try {
      const top5 = (convs || []).slice(0, MAX_CACHED_CONVS);
      localStorage.setItem(CACHE_KEY_RECENT_CONVS, JSON.stringify(top5));
    } catch (e) {}
  }

  function getCachedMessages(convId) {
    try {
      const raw = localStorage.getItem(CACHE_KEY_MSG_PREFIX + convId);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function saveCachedMessages(convId, msgs) {
    try {
      localStorage.setItem(CACHE_KEY_MSG_PREFIX + convId, JSON.stringify(msgs));
    } catch (e) {}
  }

  function renderCachedConversations() {
    const cached = getCachedConversations();
    if (cached.length > 0) {
      renderConversationsDOM(cached);
    }
  }

  // --- FONT SIZE CONTROLLER ---
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

  // --- MODEL MANAGEMENT & CLEAN DROPDOWN ---
  async function refreshModelsList() {
    availableModels = await GeminiAPI.fetchAvailableModels();

    const existingPriority = GeminiAPI.getModelPriority();
    const mergedPriority = [...new Set([...existingPriority, ...availableModels])];
    GeminiAPI.saveModelPriority(mergedPriority);

    rebuildModelDropdown(mergedPriority);
    renderPrioritySettingsList();
  }

  function rebuildModelDropdown(priorityList) {
    modelSelect.innerHTML = "";

    const autoOpt = document.createElement("option");
    autoOpt.value = "auto";
    autoOpt.textContent = "Auto Fallback";
    modelSelect.appendChild(autoOpt);

    priorityList.forEach((model) => {
      const opt = document.createElement("option");
      opt.value = model;
      opt.textContent = model;
      modelSelect.appendChild(opt);
    });

    if (lockedModel && priorityList.includes(lockedModel)) {
      modelSelect.value = lockedModel;
      modelSelectWrapper.classList.add("is-locked");
    } else {
      lockedModel = null;
      localStorage.removeItem("gemini_locked_model");
      modelSelect.value = "auto";
      modelSelectWrapper.classList.remove("is-locked");
    }
  }

  modelSelect.addEventListener("change", () => {
    const val = modelSelect.value;
    if (val === "auto") {
      lockedModel = null;
      localStorage.removeItem("gemini_locked_model");
      modelSelectWrapper.classList.remove("is-locked");
      showNotification("Switched to Auto Fallback mode.", "warning", 3000);
    } else {
      lockedModel = val;
      localStorage.setItem("gemini_locked_model", val);
      modelSelectWrapper.classList.add("is-locked");
      showNotification(`Locked model to: ${val}.`, "warning", 3000);
    }
  });

  modelSelectWrapper.querySelector(".model-lock-badge")?.addEventListener("click", (e) => {
    e.stopPropagation();
    lockedModel = null;
    localStorage.removeItem("gemini_locked_model");
    modelSelect.value = "auto";
    modelSelectWrapper.classList.remove("is-locked");
    showNotification("Unlocked model. Switched to Auto Fallback.", "warning", 3000);
  });

  btnTogglePrioritySection?.addEventListener("click", (e) => {
    if (e.target.closest("#btnRefreshModels")) return;
    const isHidden = priorityCollapsibleContent.style.display === "none";
    priorityCollapsibleContent.style.display = isHidden ? "flex" : "none";
    priorityAccordionIcon.classList.toggle("open", isHidden);
  });

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
          rebuildModelDropdown(curList);
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
          rebuildModelDropdown(curList);
          renderPrioritySettingsList();
        }
      });
    });

    function checkAndAutoScroll(clientY) {
      const rect = priorityListContainer.getBoundingClientRect();
      const topThreshold = rect.top + 35;
      const bottomThreshold = rect.bottom - 35;
      const speed = 8;

      if (clientY < topThreshold && priorityListContainer.scrollTop > 0) {
        priorityListContainer.scrollTop -= speed;
      } else if (clientY > bottomThreshold && priorityListContainer.scrollTop < (priorityListContainer.scrollHeight - priorityListContainer.clientHeight)) {
        priorityListContainer.scrollTop += speed;
      }
    }

    let dragSrcIdx = null;
    const items = priorityListContainer.querySelectorAll(".priority-item");

    items.forEach(item => {
      item.addEventListener("dragstart", (e) => {
        dragSrcIdx = parseInt(item.getAttribute("data-idx"));
        item.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", dragSrcIdx);
      });

      item.addEventListener("drag", (e) => {
        if (e.clientY > 0) checkAndAutoScroll(e.clientY);
      });

      item.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        checkAndAutoScroll(e.clientY);
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
          rebuildModelDropdown(curList);
          renderPrioritySettingsList();
        }
      });

      item.addEventListener("dragend", () => {
        items.forEach(el => el.classList.remove("dragging", "drag-over"));
        dragSrcIdx = null;
      });

      const grabHandle = item.querySelector(".priority-grab-handle");
      let currentTouchTarget = null;

      grabHandle.addEventListener("touchstart", () => {
        dragSrcIdx = parseInt(item.getAttribute("data-idx"));
        item.classList.add("dragging");
      }, { passive: false });

      grabHandle.addEventListener("touchmove", (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        checkAndAutoScroll(touch.clientY);

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
            rebuildModelDropdown(curList);
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
      saveCachedConversations(convs || []);
      renderConversationsDOM(convs || []);
    } catch (e) {
      console.warn("Failed loading conversations from Turso:", e);
    }
  }

  function renderConversationsDOM(convs) {
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
        <span class="history-title" title="${escapeHtml(c.title || "Untitled")}">${escapeHtml(c.title || "Untitled Conversation")}</span>
        <div class="history-actions">
          <button class="history-btn-action history-btn-rename" title="Rename conversation"><i class="fa-solid fa-pen"></i></button>
          <button class="history-btn-action history-btn-del" title="Delete chat"><i class="fa-solid fa-trash"></i></button>
        </div>
      `;

      item.addEventListener("click", (e) => {
        if (e.target.closest(".history-actions")) return;
        navigateTo("#/chat/" + c.id);
        closeSidebarMobile();
      });

      // Rename Conversation
      item.querySelector(".history-btn-rename").addEventListener("click", async (e) => {
        e.stopPropagation();
        const currentTitle = c.title || "Untitled Conversation";
        const newTitle = prompt("Enter new title for this conversation:", currentTitle);
        if (newTitle && newTitle.trim() && newTitle.trim() !== currentTitle) {
          await renameConversation(c.id, newTitle.trim());
        }
      });

      // Delete Single Conversation
      item.querySelector(".history-btn-del").addEventListener("click", (e) => {
        e.stopPropagation();
        promptDeleteSingle(c.id, c.title || "Untitled Conversation");
      });

      historyList.appendChild(item);
    });
  }

  async function renameConversation(convId, newTitle) {
    try {
      await TursoDB.updateConversationTitle(convId, newTitle);
      
      const cached = getCachedConversations();
      const target = cached.find(x => x.id === convId);
      if (target) {
        target.title = newTitle;
        saveCachedConversations(cached);
      }
      
      await loadConversationsList();
    } catch (e) {
      alert("Error renaming conversation: " + e.message);
    }
  }

  async function openConversation(convId, updateHash = true) {
    if (isRecordingAudio) {
      stopAudioRecording();
    }

    currentConversationId = convId;
    if (updateHash) {
      navigateTo("#/chat/" + convId);
    }

    welcomeScreen.style.display = "none";
    messagesList.innerHTML = "";

    document.querySelectorAll(".history-item").forEach(el => {
      el.classList.toggle("active", el.getAttribute("data-id") === convId);
    });

    // 1. Instantly render from local cache if available (0ms delay)
    const cachedMsgs = getCachedMessages(convId);
    if (cachedMsgs && cachedMsgs.length > 0) {
      currentMessages = cachedMsgs;
      renderMessagesArray(cachedMsgs);
    }

    // 2. Fetch fresh from Turso DB asynchronously in background
    try {
      const msgs = await TursoDB.getMessages(convId);
      currentMessages = msgs || [];
      saveCachedMessages(convId, currentMessages);

      if (!cachedMsgs || cachedMsgs.length === 0 || JSON.stringify(cachedMsgs) !== JSON.stringify(currentMessages)) {
        renderMessagesArray(currentMessages);
      }
      scrollToBottom();
    } catch (e) {
      console.error("Failed loading messages from Turso:", e);
      if (!cachedMsgs || cachedMsgs.length === 0) {
        messagesList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No messages found in this chat.</div>`;
      }
    }
  }

  function renderMessagesArray(msgs) {
    messagesList.innerHTML = "";
    if (!msgs || msgs.length === 0) {
      messagesList.innerHTML = `<div style="text-align: center; color: var(--text-muted); padding: 20px;">No messages found in this chat.</div>`;
      return;
    }

    msgs.forEach(msg => {
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
      appendMessageUI(
        msg.role || "user",
        msg.content || "",
        parsedFiles,
        msg.model_used || "",
        false,
        msg.id || ("msg_" + Math.random()),
        msg.translation || ""
      );
    });
  }

  function startNewConversation(updateHash = true) {
    if (isRecordingAudio) {
      stopAudioRecording();
    }

    currentConversationId = null;
    currentMessages = [];
    messagesList.innerHTML = "";
    welcomeScreen.style.display = "flex";
    attachedFiles = [];
    renderAttachmentPreviews();
    document.querySelectorAll(".history-item").forEach(el => el.classList.remove("active"));
    closeSidebarMobile();
    chatTextarea.focus();

    if (updateHash) {
      navigateTo("#/new");
    }
  }

  // =========================================================================
  // MINIMAL DELETION PROCESS WINDOW CONTROLLER
  // =========================================================================
  function setStepState(stepElement, state) {
    if (!stepElement) return;
    const icon = stepElement.querySelector("i");
    stepElement.className = "delete-step-item " + state;

    if (state === "active") {
      if (icon) icon.className = "fa-solid fa-spinner fa-spin";
    } else if (state === "done") {
      if (icon) icon.className = "fa-solid fa-circle-check";
    } else {
      if (icon) icon.className = "fa-regular fa-circle";
    }
  }

  function resetDeleteModalViews() {
    deleteConfirmView.style.display = "block";
    deleteProcessView.style.display = "none";
    deleteCompleteView.style.display = "none";

    setStepState(stepStorage, "");
    setStepState(stepDatabase, "");
    setStepState(stepCache, "");
  }

  function promptDeleteSingle(convId, title) {
    pendingDeleteAction = { type: "single", id: convId };
    deleteModalTitle.textContent = "Delete Conversation";
    deleteModalMessage.textContent = `Are you sure you want to delete "${title}"? All messages and attachments will be permanently removed.`;
    resetDeleteModalViews();
    deleteModal.classList.add("open");
  }

  function promptClearAll() {
    pendingDeleteAction = { type: "all" };
    deleteModalTitle.textContent = "Clear All History";
    deleteModalMessage.textContent = "Are you sure you want to permanently clear all conversations and media files? This cannot be undone.";
    resetDeleteModalViews();
    deleteModal.classList.add("open");
  }

  function closeDeleteModal() {
    deleteModal.classList.remove("open");
    pendingDeleteAction = null;
  }

  btnCloseDeleteModal?.addEventListener("click", closeDeleteModal);
  btnCancelDelete?.addEventListener("click", closeDeleteModal);

  btnConfirmDelete?.addEventListener("click", async () => {
    if (!pendingDeleteAction) return;

    deleteConfirmView.style.display = "none";
    deleteProcessView.style.display = "block";
    deleteStatusText.textContent = pendingDeleteAction.type === "all" ? "Clearing all history..." : "Deleting conversation...";

    try {
      if (pendingDeleteAction.type === "single") {
        const convId = pendingDeleteAction.id;

        // Step 1: Storage
        setStepState(stepStorage, "active");
        SyncQueue.clearTasksForConversation(convId);
        await SupabaseStorage.deleteConversationFiles(convId);
        setStepState(stepStorage, "done");

        // Step 2: Database
        setStepState(stepDatabase, "active");
        await TursoDB.deleteConversation(convId);
        setStepState(stepDatabase, "done");

        // Step 3: Cache & State
        setStepState(stepCache, "active");
        localStorage.removeItem(CACHE_KEY_MSG_PREFIX + convId);
        const cached = getCachedConversations().filter(x => x.id !== convId);
        saveCachedConversations(cached);
        setStepState(stepCache, "done");

        if (currentConversationId === convId) {
          startNewConversation(true);
        }
        await loadConversationsList();

        deleteCompleteText.textContent = "Conversation deleted successfully.";
      } else {
        // Step 1: Storage
        setStepState(stepStorage, "active");
        SyncQueue.clearAll();
        await SupabaseStorage.clearAllStorage();
        setStepState(stepStorage, "done");

        // Step 2: Database
        setStepState(stepDatabase, "active");
        await TursoDB.clearAllHistory();
        setStepState(stepDatabase, "done");

        // Step 3: Cache & State
        setStepState(stepCache, "active");
        const cached = getCachedConversations();
        cached.forEach(c => localStorage.removeItem(CACHE_KEY_MSG_PREFIX + c.id));
        localStorage.removeItem(CACHE_KEY_RECENT_CONVS);
        setStepState(stepCache, "done");

        startNewConversation(true);
        await loadConversationsList();

        deleteCompleteText.textContent = "All history cleared successfully.";
      }

      // Transition to Complete state
      deleteProcessView.style.display = "none";
      deleteCompleteView.style.display = "flex";

      setTimeout(() => {
        closeDeleteModal();
      }, 700);

    } catch (err) {
      alert("Deletion error: " + err.message);
      closeDeleteModal();
    }
  });

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
        if (!f || (!f.url && !f.dataUrl)) return;
        const fileType = (f.type || "").toLowerCase();
        const fileName = (f.name || "attachment").toLowerCase();
        const safeName = escapeHtml(f.name || "attachment");
        const safeUrl = f.url || f.dataUrl;

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
              <video src="${safeUrl}" controls preload="metadata"></video>
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
              <audio src="${safeUrl}" controls preload="metadata"></audio>
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

    // Model Header Icon: ONLY shown when content is displayed (NOT while thinking)
    let headerNode = null;
    if (role === "model") {
      headerNode = document.createElement("div");
      headerNode.className = "model-row-header";
      headerNode.innerHTML = `
        <div class="model-avatar-compact">
          <img src="gemini-ai.svg" alt="Gemini" class="gemini-icon model-avatar-icon" />
        </div>
      `;
      if (!isStreaming || (content && content.trim())) {
        row.appendChild(headerNode);
      }
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    let renderedText = "";
    if (role === "model") {
      if (isStreaming && !content) {
        // Minimal 3-dot thinking indicator without logo
        renderedText = `
          <div class="gemini-thinking-indicator">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
        `;
      } else {
        try {
          renderedText = content ? DOMPurify.sanitize(marked.parse(content)) : "";
        } catch (e) {
          renderedText = escapeHtml(content);
        }
      }
    } else {
      renderedText = escapeHtml(content);
    }

    // Action footer with minimal muted Translate text (only when answer is showed)
    let actionFooterHtml = "";
    if (role === "model") {
      const showFooter = !isStreaming || (content && content.trim().length > 0);
      actionFooterHtml = `
        <div class="model-action-bar" style="${showFooter ? '' : 'display: none;'}">
          <div class="model-action-left">
            <button class="btn-translate-farsi" title="Translate answer to Persian">
              <span>Translate</span>
            </button>
          </div>
          <div class="model-attribution">
            ${modelUsed ? `<span>${escapeHtml(modelUsed)}</span>` : ""}
          </div>
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

    if (existingTranslation) {
      const slot = bubble.querySelector(".translation-container-slot");
      if (slot) renderTranslationBox(slot, existingTranslation);
    }

    if (role === "model") {
      const btnTranslate = bubble.querySelector(".btn-translate-farsi");
      if (btnTranslate) {
        btnTranslate.addEventListener("click", () => handleTranslateClick(bubble, content, messageId, btnTranslate));
      }
    }

    row.appendChild(bubble);
    messagesList.appendChild(row);

    return { row, bubble, headerNode };
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

  // --- TRANSLATE ACTION (MUTED MINIMAL TEXT TRIGGER) ---
  async function handleTranslateClick(bubble, rawContent, msgId, btnTranslate) {
    const slot = bubble.querySelector(".translation-container-slot");
    if (!slot) return;

    if (slot.innerHTML.trim().length > 0) {
      slot.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }

    let textToTranslate = rawContent;
    if (!textToTranslate || typeof textToTranslate !== "string" || !textToTranslate.trim()) {
      const contentEl = bubble.querySelector(".message-content");
      textToTranslate = contentEl ? (contentEl.innerText || contentEl.textContent || "") : "";
    }

    if (!textToTranslate || !textToTranslate.trim()) {
      alert("No message content found to translate.");
      return;
    }

    const originalBtnHtml = btnTranslate.innerHTML;
    btnTranslate.classList.add("loading");
    btnTranslate.innerHTML = `<i class="fa-solid fa-spinner fa-spin" style="font-size: 10px;"></i> <span>Translating...</span>`;

    try {
      const activeModel = lockedModel || modelSelect.value || "gemini-2.5-flash";
      const farsiTranslation = await GeminiAPI.translateToFarsi(textToTranslate, activeModel);

      renderTranslationBox(slot, farsiTranslation);

      if (msgId && currentConversationId) {
        const cached = getCachedMessages(currentConversationId);
        if (cached) {
          const m = cached.find(x => x.id === msgId);
          if (m) m.translation = farsiTranslation;
          saveCachedMessages(currentConversationId, cached);
        }

        SyncQueue.enqueue({
          type: "UPDATE_TRANSLATION",
          conversationId: currentConversationId,
          messageId: msgId,
          translation: farsiTranslation
        });
      }

      btnTranslate.innerHTML = originalBtnHtml;
    } catch (err) {
      alert("Translation failed: " + err.message);
      btnTranslate.innerHTML = originalBtnHtml;
    } finally {
      btnTranslate.classList.remove("loading");
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
      <div class="message-translation-box" dir="rtl">
        <div class="translation-header">
          <span class="badge-translated">ترجمه</span>
          <button class="btn-copy-translation" title="کپی ترجمه"><i class="fa-regular fa-copy"></i> کپی</button>
        </div>
        <div class="translation-content" dir="rtl">${sanitizedHtml}</div>
      </div>
    `;

    setupCodeBlockHeaders(slotElement);

    const copyBtn = slotElement.querySelector(".btn-copy-translation");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const textToCopy = slotElement.querySelector(".translation-content").innerText;
        navigator.clipboard.writeText(textToCopy);
        copyBtn.innerHTML = `<i class="fa-solid fa-check"></i> کپی شد`;
        setTimeout(() => {
          copyBtn.innerHTML = `<i class="fa-regular fa-copy"></i> کپی`;
        }, 2000);
      });
    }
  }

  function scrollToBottom() {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  }

  // =========================================================================
  // AUDIO & VOICE INPUT RECORDING ENGINE
  // =========================================================================
  let isRecordingAudio = false;
  let mediaRecorder = null;
  let audioChunks = [];
  let mediaStream = null;
  let speechRecognizer = null;
  let baseTextBeforeRecording = "";

  async function toggleAudioRecording() {
    if (isRecordingAudio) {
      stopAudioRecording();
    } else {
      await startAudioRecording();
    }
  }

  async function startAudioRecording() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const hasGetUserMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

    if (!SpeechRecognition && !hasGetUserMedia) {
      showNotification("Audio / Speech recording is not supported on this browser.", "warning", 4000);
      return;
    }

    isRecordingAudio = true;
    btnMic?.classList.add("recording");
    if (btnMic) {
      btnMic.title = "Stop recording (Listening...)";
      btnMic.innerHTML = `<i class="fa-solid fa-stop"></i>`;
    }
    chatTextarea.placeholder = "Listening... Speak now...";

    baseTextBeforeRecording = chatTextarea.value;
    if (baseTextBeforeRecording && !baseTextBeforeRecording.endsWith(" ")) {
      baseTextBeforeRecording += " ";
    }

    let recognitionStarted = false;

    if (SpeechRecognition) {
      try {
        speechRecognizer = new SpeechRecognition();
        speechRecognizer.continuous = true;
        speechRecognizer.interimResults = true;
        const isRtl = document.documentElement.getAttribute("dir") === "rtl";
        speechRecognizer.lang = isRtl ? "fa-IR" : (navigator.language || "en-US");

        speechRecognizer.onresult = (event) => {
          let interimTranscript = "";
          let finalTranscript = "";
          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalTranscript += event.results[i][0].transcript;
            } else {
              interimTranscript += event.results[i][0].transcript;
            }
          }
          const recognizedText = (finalTranscript || interimTranscript).trim();
          if (recognizedText) {
            chatTextarea.value = (baseTextBeforeRecording + recognizedText).trim();
            autoResizeTextarea();
            toggleSendButton();
          }
        };

        speechRecognizer.onerror = (e) => {
          console.warn("Speech recognition note:", e.error);
        };

        speechRecognizer.onend = () => {
          if (isRecordingAudio && speechRecognizer) {
            try {
              speechRecognizer.start();
            } catch (e) {}
          }
        };

        speechRecognizer.start();
        recognitionStarted = true;
      } catch (err) {
        console.warn("Speech recognition initialization note:", err);
      }
    }

    if (hasGetUserMedia) {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];

        let mimeType = "";
        if (typeof MediaRecorder !== "undefined") {
          if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
            mimeType = "audio/webm;codecs=opus";
          } else if (MediaRecorder.isTypeSupported("audio/webm")) {
            mimeType = "audio/webm";
          } else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) {
            mimeType = "audio/ogg;codecs=opus";
          } else if (MediaRecorder.isTypeSupported("audio/mp4")) {
            mimeType = "audio/mp4";
          }
        }

        if (typeof MediaRecorder !== "undefined") {
          mediaRecorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);

          mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              audioChunks.push(e.data);
            }
          };

          mediaRecorder.onstop = () => {
            const actualType = mediaRecorder.mimeType || "audio/webm";
            const audioBlob = new Blob(audioChunks, { type: actualType });

            if (!chatTextarea.value.trim() && audioBlob.size > 800) {
              const ext = actualType.includes("ogg") ? "ogg" : actualType.includes("mp4") ? "mp4" : "webm";
              const audioFile = new File([audioBlob], `voice_recording_${Date.now()}.${ext}`, {
                type: actualType,
                lastModified: Date.now()
              });
              attachedFiles.push(audioFile);
              renderAttachmentPreviews();
            }

            if (mediaStream) {
              mediaStream.getTracks().forEach(t => t.stop());
              mediaStream = null;
            }
            toggleSendButton();
          };

          mediaRecorder.start(250);
        }
      } catch (micErr) {
        console.warn("Microphone access issue:", micErr);
        if (!recognitionStarted) {
          if (micErr.name === "NotAllowedError" || micErr.name === "PermissionDeniedError") {
            showNotification("Microphone access was denied. Please allow microphone permissions.", "warning", 4000);
          } else {
            showNotification("Microphone error: " + (micErr.message || "Unable to access microphone"), "warning", 4000);
          }
          stopAudioRecording();
        }
      }
    }
  }

  function stopAudioRecording() {
    if (!isRecordingAudio) return;
    isRecordingAudio = false;

    btnMic?.classList.remove("recording");
    if (btnMic) {
      btnMic.title = "Voice input (Speech to text / Audio recording)";
      btnMic.innerHTML = `<i class="fa-solid fa-microphone"></i>`;
    }
    chatTextarea.placeholder = "Type a message...";

    if (speechRecognizer) {
      try {
        speechRecognizer.onend = null;
        speechRecognizer.stop();
      } catch (e) {}
      speechRecognizer = null;
    }

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      try {
        mediaRecorder.stop();
      } catch (e) {}
    } else if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }

    toggleSendButton();
  }

  // =========================================================================
  // OPTIMISTIC SEND MESSAGE & INSTANT AI DISPATCH
  // =========================================================================
  async function handleSendMessage() {
    if (isRecordingAudio) {
      stopAudioRecording();
    }

    const prompt = chatTextarea.value.trim();
    if ((!prompt && attachedFiles.length === 0) || isGenerating) return;

    const selectedModel = modelSelect.value || "auto";
    const isStreaming = localStorage.getItem("gemini_streaming_enabled") !== "false";
    const now = Date.now();

    // 1. Instantly free input box
    const filesToPassToGemini = [...attachedFiles];
    chatTextarea.value = "";
    attachedFiles = [];
    renderAttachmentPreviews();
    autoResizeTextarea();
    btnSend.disabled = true;

    // 2. Prepare local attachments preview snapshots
    const immediateUIFiles = [];
    for (const f of filesToPassToGemini) {
      const dataUrl = await SupabaseStorage.fileToDataUrl(f);
      immediateUIFiles.push({
        name: f.name,
        type: f.type,
        size: f.size,
        dataUrl: dataUrl,
        url: dataUrl,
        uploaded: false
      });
    }

    // 3. Initialize or update conversation
    let convTitle = "";
    if (!currentConversationId) {
      currentConversationId = "conv_" + now;
      convTitle = prompt ? prompt.slice(0, 32) : (filesToPassToGemini[0]?.name || "Media Chat");

      const cachedConvs = getCachedConversations();
      cachedConvs.unshift({ id: currentConversationId, title: convTitle, created_at: now, updated_at: now });
      saveCachedConversations(cachedConvs);
      renderConversationsDOM(cachedConvs);

      navigateTo("#/chat/" + currentConversationId);

      SyncQueue.enqueue({
        type: "SAVE_CONV",
        conversationId: currentConversationId,
        title: convTitle,
        createdAt: now,
        updatedAt: now
      });
    } else {
      SyncQueue.enqueue({
        type: "UPDATE_CONV_TIME",
        conversationId: currentConversationId,
        updatedAt: now
      });
    }

    // 4. Render User Message immediately
    const userMsgId = "msg_" + now;
    const filesJson = JSON.stringify(immediateUIFiles);

    appendMessageUI("user", prompt, immediateUIFiles, "", false, userMsgId);
    currentMessages.push({ role: "user", content: prompt, files: filesJson, id: userMsgId });
    saveCachedMessages(currentConversationId, currentMessages);
    scrollToBottom();

    SyncQueue.enqueue({
      type: "SAVE_USER_MSG",
      conversationId: currentConversationId,
      messageId: userMsgId,
      content: prompt,
      files: immediateUIFiles,
      createdAt: now
    });

    // 5. Kick off AI Generation
    const aiMsgId = "msg_" + (now + 1);
    await executeGeneration({
      prompt,
      filesToPassToGemini,
      aiMsgId,
      selectedModel,
      isStreaming
    });
  }

  // --- GENERATION EXECUTION WITH RETRY SUPPORT ---
  async function executeGeneration({ prompt, filesToPassToGemini, aiMsgId, selectedModel, isStreaming }) {
    isGenerating = true;
    hideNotification();

    const aiMessagePlaceholder = appendMessageUI("model", "", [], "", true, aiMsgId);
    const contentContainer = aiMessagePlaceholder.bubble.querySelector(".message-content");
    const actionBar = aiMessagePlaceholder.bubble.querySelector(".model-action-bar");

    let finalAssistantText = "";
    let actualModelUsed = lockedModel || selectedModel;

    try {
      const cleanHistoryForGemini = currentMessages.slice(0, -1).map(m => ({
        role: m.role,
        content: m.content
      }));

      const result = await GeminiAPI.generate({
        selectedModel: selectedModel,
        lockedModel: lockedModel,
        historyMessages: cleanHistoryForGemini,
        newPrompt: prompt,
        attachedFiles: filesToPassToGemini,
        isStreaming: isStreaming,
        onChunk: (chunk, fullText) => {
          finalAssistantText = fullText;

          // Ensure icon is shown next to the answer when response appears
          if (!aiMessagePlaceholder.row.querySelector(".model-row-header") && aiMessagePlaceholder.headerNode) {
            aiMessagePlaceholder.row.insertBefore(aiMessagePlaceholder.headerNode, aiMessagePlaceholder.bubble);
          }

          try {
            contentContainer.innerHTML = DOMPurify.sanitize(marked.parse(fullText));
          } catch (e) {
            contentContainer.textContent = fullText;
          }
          setupCodeBlockHeaders(contentContainer);
        },
        onFallbackNotice: (msg) => {
          showNotification(msg, "warning", 3000);
        }
      });

      finalAssistantText = result.text;
      actualModelUsed = result.modelUsed;

      // Show icon next to answer if not already inserted
      if (!aiMessagePlaceholder.row.querySelector(".model-row-header") && aiMessagePlaceholder.headerNode) {
        aiMessagePlaceholder.row.insertBefore(aiMessagePlaceholder.headerNode, aiMessagePlaceholder.bubble);
      }

      // Show minimal Translate action
      if (actionBar) {
        actionBar.style.display = "flex";
      }

      const attr = aiMessagePlaceholder.bubble.querySelector(".model-attribution");
      if (attr && actualModelUsed) {
        attr.innerHTML = `<span>${escapeHtml(actualModelUsed)}</span>`;
      }

      const btnTranslate = aiMessagePlaceholder.bubble.querySelector(".btn-translate-farsi");
      if (btnTranslate) {
        btnTranslate.addEventListener("click", () => handleTranslateClick(aiMessagePlaceholder.bubble, finalAssistantText, aiMsgId, btnTranslate));
      }

      // 6. Update local in-memory messages & cache
      currentMessages.push({ role: "model", content: finalAssistantText, model_used: actualModelUsed, id: aiMsgId });
      saveCachedMessages(currentConversationId, currentMessages);

      // 7. Queue model message save in background
      SyncQueue.enqueue({
        type: "SAVE_MODEL_MSG",
        conversationId: currentConversationId,
        messageId: aiMsgId,
        content: finalAssistantText,
        modelUsed: actualModelUsed,
        filesJson: "[]",
        createdAt: Date.now(),
        translation: ""
      });

    } catch (err) {
      // If generation fails, show error and provide minimal retry button (no duplicate DB re-upload)
      contentContainer.innerHTML = `
        <div style="color: var(--danger-color); font-size: 13px;">
          <i class="fa-solid fa-circle-exclamation"></i> ${escapeHtml(err.message)}
        </div>
        <button class="btn-retry-send" title="Retry sending message">
          <i class="fa-solid fa-rotate-right"></i> <span>Retry</span>
        </button>
      `;

      const btnRetry = contentContainer.querySelector(".btn-retry-send");
      if (btnRetry) {
        btnRetry.addEventListener("click", async () => {
          btnRetry.disabled = true;
          btnRetry.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Retrying...</span>`;
          
          // Remove the failed placeholder and retry without re-inserting user message/uploading files
          aiMessagePlaceholder.row.remove();
          await executeGeneration({
            prompt,
            filesToPassToGemini,
            aiMsgId: "msg_" + Date.now(),
            selectedModel: modelSelect.value || "auto",
            isStreaming
          });
        });
      }
    } finally {
      isGenerating = false;
      btnSend.disabled = false;
      hideNotification();

      SyncQueue.process();
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

  // --- NOTIFICATION BANNER WITH AUTO-HIDE ---
  function showNotification(msg, type = "warning", autoHideMs = 3000) {
    if (notificationTimer) clearTimeout(notificationTimer);
    notificationBanner.className = `notification-banner ${type}`;
    notificationBannerContent.innerHTML = `<span>${escapeHtml(msg)}</span>`;
    notificationBanner.style.display = "flex";

    if (autoHideMs > 0) {
      notificationTimer = setTimeout(() => {
        hideNotification();
      }, autoHideMs);
    }
  }

  function hideNotification() {
    if (notificationTimer) clearTimeout(notificationTimer);
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
  btnOpenSettings.addEventListener("click", () => {
    navigateTo("#/settings");
  });

  btnCloseSettings.addEventListener("click", () => {
    navigateTo(currentConversationId ? "#/chat/" + currentConversationId : "#/new");
  });

  btnCancelSettings.addEventListener("click", () => {
    navigateTo(currentConversationId ? "#/chat/" + currentConversationId : "#/new");
  });

  function openSettingsModal(updateHash = true) {
    settingApiKeys.value = GeminiAPI.getApiKeys().join("\n");
    settingStreaming.checked = localStorage.getItem("gemini_streaming_enabled") !== "false";
    settingCaching.checked = localStorage.getItem("gemini_caching_enabled") !== "false";
    settingThemeToggle.checked = (document.documentElement.getAttribute("data-theme") || "dark") === "light";
    renderPrioritySettingsList();
    settingsModal.classList.add("open");
    if (updateHash) {
      navigateTo("#/settings");
    }
  }

  function closeSettingsModal(updateHash = true) {
    settingsModal.classList.remove("open");
    if (updateHash) {
      navigateTo(currentConversationId ? "#/chat/" + currentConversationId : "#/new");
    }
  }

  btnSaveSettings.addEventListener("click", async () => {
    localStorage.setItem("gemini_api_keys", settingApiKeys.value.trim());
    localStorage.setItem("gemini_streaming_enabled", settingStreaming.checked ? "true" : "false");
    localStorage.setItem("gemini_caching_enabled", settingCaching.checked ? "true" : "false");
    applyTheme(settingThemeToggle.checked ? "light" : "dark");
    closeSettingsModal(true);
    await refreshModelsList();
  });

  btnRefreshModels.addEventListener("click", async (e) => {
    e.stopPropagation();
    localStorage.setItem("gemini_api_keys", settingApiKeys.value.trim());
    await refreshModelsList();
  });

  // --- GENERAL BUTTON LISTENERS ---
  btnNewChat.addEventListener("click", () => startNewConversation(true));
  btnHeaderNewChat.addEventListener("click", () => startNewConversation(true));
  btnClearAllHistory.addEventListener("click", promptClearAll);
  btnThemeToggle.addEventListener("click", toggleTheme);
  btnRTLToggle.addEventListener("click", toggleDirection);
  btnHeaderRTL.addEventListener("click", toggleDirection);
  btnMic.addEventListener("click", toggleAudioRecording);
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