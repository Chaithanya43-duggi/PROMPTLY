/**
 * Promptly — Content Script
 * DOM scanner, MutationObserver, and 1500ms debounce engine.
 * Detects the active prompt textarea on ChatGPT, Claude, and Gemini,
 * binds input listeners, and calls the FastAPI backend for analysis.
 */

(function () {
  "use strict";

  // ─── Platform Detection ───────────────────────────────────────────
  // Broad selector chains — tried top-to-bottom, first match wins.
  // Updated for mid-2026 DOM structures.
  const PLATFORM_SELECTORS = {
    chatgpt: [
      "textarea#mobile-composer-prompt",
      'textarea[class*="composer"]',
      "#prompt-textarea",
      'div[contenteditable="true"][id="prompt-textarea"]',
      'div[contenteditable="true"].ProseMirror',
      'div[contenteditable="true"][data-id]',
      'textarea[data-id="root"]',
      'form div[contenteditable="true"]',
      'form textarea',
    ],
    claude: [
      'div[contenteditable="true"].ProseMirror',
      '.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][data-placeholder]',
      'fieldset div[contenteditable="true"]',
      'div[contenteditable="true"][enterkeyhint]',
      'div.ProseMirror',
    ],
    gemini: [
      'rich-textarea [contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      '.ql-editor[contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="prompt"]',
      'div[contenteditable="true"][aria-label*="Enter"]',
      'div[contenteditable="true"][aria-label*="enter"]',
      "rich-textarea textarea",
    ],
  };

  function detectPlatform() {
    const host = window.location.hostname;
    if (host.includes("chatgpt.com")) return "chatgpt";
    if (host.includes("claude.ai")) return "claude";
    if (host.includes("gemini.google.com")) return "gemini";
    return null;
  }

  function findTextarea(platform) {
    const selectors = PLATFORM_SELECTORS[platform];
    if (!selectors) return null;
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) return el;
      } catch (e) {
        // Invalid selector — skip silently
      }
    }
    return null;
  }

  function getText(el) {
    if (!el) return "";
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return el.value;
    }
    return el.innerText || el.textContent || "";
  }

  // ─── Backend API (via Background Service Worker) ──────────────────
  async function analyzePrompt(text) {
    return new Promise((resolve) => {
      try {
        // Guard: extension context may have been invalidated (after update/reload)
        if (!chrome.runtime || !chrome.runtime.id) {
          console.warn("[Promptly] Extension context invalidated.");
          resolve({ issues: [], warning: "Extension reloaded — please refresh the page." });
          return;
        }

        chrome.runtime.sendMessage({ action: "analyzePrompt", text: text }, (response) => {
          // Check for runtime errors (service worker was inactive or restarting)
          if (chrome.runtime.lastError) {
            console.warn("[Promptly] Message error:", chrome.runtime.lastError.message);
            resolve({ issues: [], warning: "Extension reconnecting..." });
            return;
          }
          if (!response || !response.success) {
            console.warn("[Promptly] Backend unavailable or error:", response?.error || "Unknown error");
            resolve({ issues: [], warning: "Backend offline" });
          } else {
            resolve(response.data);
          }
        });
      } catch (e) {
        console.warn("[Promptly] Runtime error:", e.message);
        resolve({ issues: [], warning: "Extension error" });
      }

      // Safety timeout — resolve after 15s if nothing comes back
      setTimeout(() => {
        resolve({ issues: [], warning: "Request timed out" });
      }, 15000);
    });
  }

  // ─── Debounce Timer ───────────────────────────────────────────────
  let debounceTimer = null;
  const DEBOUNCE_MS = 1500;

  function triggerDebounced(text) {
    clearTimeout(debounceTimer);
    if (!text || !text.trim()) {
      if (window.promptlyRenderIssues) {
        window.promptlyRenderIssues([], null);
      }
      return;
    }
    debounceTimer = setTimeout(async () => {
      const data = await analyzePrompt(text);
      if (window.promptlyRenderIssues) {
        window.promptlyRenderIssues(data.issues || [], data.warning || null);
      }
    }, DEBOUNCE_MS);
  }

  // Expose for widget.js to call after accepting a fix
  window.promptlyTriggerImmediate = async function (text) {
    clearTimeout(debounceTimer);
    if (!text || !text.trim()) {
      if (window.promptlyRenderIssues) window.promptlyRenderIssues([], null);
      return;
    }
    const data = await analyzePrompt(text);
    if (window.promptlyRenderIssues) {
      window.promptlyRenderIssues(data.issues || [], data.warning || null);
    }
  };

  // ─── Binding & Observer ───────────────────────────────────────────
  let currentTextarea = null;
  let inputHandler = null;

  function bindToTextarea(textarea) {
    if (currentTextarea === textarea) return;

    // Unbind previous
    if (currentTextarea && inputHandler) {
      currentTextarea.removeEventListener("input", inputHandler);
      currentTextarea.removeEventListener("keyup", inputHandler);
    }

    currentTextarea = textarea;

    inputHandler = () => {
      const text = getText(textarea);
      triggerDebounced(text);
    };

    textarea.addEventListener("input", inputHandler);
    textarea.addEventListener("keyup", inputHandler);

    // Initialize widget attachment
    if (window.promptlyAttachWidget) {
      window.promptlyAttachWidget(textarea);
    } else {
      window.promptlyActiveTextarea = textarea;
    }

    console.log("[Promptly] Bound to textarea:", textarea.tagName, textarea.id || textarea.className);
  }

  function scanAndBind() {
    const platform = detectPlatform();
    if (!platform) return;

    const textarea = findTextarea(platform);
    if (textarea && textarea !== currentTextarea) {
      bindToTextarea(textarea);
    }
  }

  // ─── MutationObserver (throttled) ─────────────────────────────────
  let mutationTimer = null;
  const observer = new MutationObserver(() => {
    // Throttle mutation callbacks to avoid excessive scanAndBind calls on SPAs
    if (mutationTimer) return;
    mutationTimer = setTimeout(() => {
      mutationTimer = null;
      scanAndBind();
    }, 500);
  });

  // ─── Initialize ───────────────────────────────────────────────────
  function init() {
    const platform = detectPlatform();
    if (!platform) {
      console.log("[Promptly] Not on a supported platform.");
      return;
    }

    console.log(`[Promptly] Detected platform: ${platform}`);

    // Initial scan
    scanAndBind();

    // Watch for dynamic DOM changes (SPA navigation, chat switches)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Periodic fallback scan (some SPAs delay rendering significantly)
    setInterval(scanAndBind, 2000);
  }

  // Wait for DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    // Small delay to let SPA frameworks render their UI first
    setTimeout(init, 500);
  }

  // Expose getText for widget.js
  window.promptlyGetText = getText;
})();
