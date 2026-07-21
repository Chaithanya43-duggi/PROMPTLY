/**
 * Promptly — Background Service Worker (MV3)
 * Proxies API requests from content scripts to the local FastAPI backend.
 * This avoids Mixed Content blocking (HTTPS page → HTTP localhost).
 */

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "analyzePrompt") {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000); // 12s timeout

    fetch("http://localhost:8000/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_text: request.text }),
      signal: controller.signal,
    })
      .then((response) => {
        clearTimeout(timeoutId);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        sendResponse({ success: true, data: data });
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        const msg = error.name === "AbortError"
          ? "Request timed out — is the backend running?"
          : error.message;
        console.warn("[Promptly Background]", msg);
        sendResponse({ success: false, error: msg });
      });

    // Return true to indicate we will send a response asynchronously
    return true;
  }
});

// Log when the service worker starts (helps with debugging)
console.log("[Promptly] Background service worker started.");
