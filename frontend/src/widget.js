/**
 * Promptly — Widget Engine
 * Floating pill, mirror-div overlay highlights, tooltip popover,
 * and React-state-synced text replacement with cascade re-analysis.
 *
 * All widget elements are attached to document.body with position:fixed
 * to avoid host-page overflow:hidden clipping and layout interference.
 */

(function () {
  "use strict";

  let activeTextarea = null;
  let currentIssues = [];
  let pillEl = null;
  let mirrorEl = null;
  let tooltipEl = null;
  let positionInterval = null;
  let scrollListeners = [];

  // ─── Utility ──────────────────────────────────────────────────────
  function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  function getText(el) {
    return window.promptlyGetText ? window.promptlyGetText(el) : (el.value || el.innerText || "");
  }

  // ─── Computed Style Copy ──────────────────────────────────────────
  const MIRROR_PROPS = [
    "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
    "wordSpacing", "lineHeight", "textTransform", "textIndent",
    "whiteSpace", "wordWrap", "overflowWrap", "tabSize",
    "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
    "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "borderTopStyle", "borderRightStyle", "borderBottomStyle", "borderLeftStyle",
    "direction", "textAlign",
  ];

  function copyStyles(source, target) {
    const cs = window.getComputedStyle(source);
    for (const prop of MIRROR_PROPS) {
      target.style[prop] = cs[prop];
    }
    // Force border-box so offsetWidth/Height includes padding+border
    target.style.boxSizing = "border-box";
    target.style.width = source.offsetWidth + "px";
    target.style.height = source.offsetHeight + "px";
  }

  // ─── Cleanup ──────────────────────────────────────────────────────
  function cleanup() {
    if (positionInterval) { clearInterval(positionInterval); positionInterval = null; }
    if (pillEl) { pillEl.remove(); pillEl = null; }
    if (mirrorEl) { mirrorEl.remove(); mirrorEl = null; }
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null; }
    scrollListeners.forEach(({ el, handler }) => el.removeEventListener("scroll", handler));
    scrollListeners = [];
    activeTextarea = null;
    currentIssues = [];
  }

  // ─── Floating Pill ────────────────────────────────────────────────
  function createPill() {
    if (pillEl) pillEl.remove();

    pillEl = document.createElement("div");
    pillEl.className = "promptly-pill";
    pillEl.innerHTML = `
      <span class="promptly-pill-letter">P</span>
      <span class="promptly-pill-badge" style="display:none;">0</span>
    `;
    pillEl.title = "Promptly — Prompt Optimizer";

    pillEl.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      if (currentIssues.length > 0) {
        showTooltip(currentIssues[0], pillEl.getBoundingClientRect());
      }
    });

    // Attach to body so it's never clipped by parent overflow
    document.body.appendChild(pillEl);
    return pillEl;
  }

  function positionPill(textarea) {
    if (!pillEl) return;
    const rect = textarea.getBoundingClientRect();

    // Hide pill if textarea is not visible
    if (rect.width === 0 || rect.height === 0) {
      pillEl.style.display = "none";
      return;
    }
    pillEl.style.display = "flex";
    pillEl.style.position = "fixed";
    pillEl.style.top = (rect.bottom - 40) + "px";
    pillEl.style.left = (rect.right - 44) + "px";
    pillEl.style.zIndex = "2147483646";
  }

  function updatePillBadge(count) {
    if (!pillEl) return;
    const badge = pillEl.querySelector(".promptly-pill-badge");
    if (!badge) return;

    if (count > 0) {
      badge.textContent = count > 9 ? "9+" : count;
      badge.style.display = "flex";

      // Color based on highest priority issue
      const hasClarity = currentIssues.some((i) => i.category === "Clarity");
      const hasContext = currentIssues.some((i) => i.category === "Context");
      if (hasClarity) badge.className = "promptly-pill-badge promptly-badge-red";
      else if (hasContext) badge.className = "promptly-pill-badge promptly-badge-blue";
      else badge.className = "promptly-pill-badge promptly-badge-green";
    } else {
      badge.style.display = "none";
    }
  }

  // ─── Mirror Overlay ───────────────────────────────────────────────
  function createMirror() {
    if (mirrorEl) mirrorEl.remove();

    mirrorEl = document.createElement("div");
    mirrorEl.className = "promptly-mirror";
    mirrorEl.setAttribute("aria-hidden", "true");

    // Attach to body with fixed positioning
    document.body.appendChild(mirrorEl);
    return mirrorEl;
  }

  function positionMirror(textarea) {
    if (!mirrorEl) return;
    const rect = textarea.getBoundingClientRect();

    // Hide mirror if textarea is not visible
    if (rect.width === 0 || rect.height === 0) {
      mirrorEl.style.display = "none";
      return;
    }
    mirrorEl.style.display = "block";
    mirrorEl.style.position = "fixed";
    mirrorEl.style.top = rect.top + "px";
    mirrorEl.style.left = rect.left + "px";
    mirrorEl.style.zIndex = "2147483645";
    mirrorEl.style.pointerEvents = "none";

    copyStyles(textarea, mirrorEl);

    // Make border transparent so it takes up space but doesn't show
    mirrorEl.style.borderColor = "transparent";
  }

  function renderMirror(textarea, issues) {
    if (!mirrorEl) return;

    const text = getText(textarea);
    if (!text || issues.length === 0) {
      mirrorEl.innerHTML = "";
      return;
    }

    // Build HTML with marks inserted at index positions
    const chars = [];
    for (let i = 0; i < text.length; i++) {
      chars.push({ char: text[i], issueStart: null, issueEnd: null });
    }

    // Tag characters with issue boundaries
    for (let idx = 0; idx < issues.length; idx++) {
      const issue = issues[idx];
      if (issue.start_idx >= 0 && issue.end_idx <= text.length) {
        if (issue.start_idx < chars.length) {
          chars[issue.start_idx].issueStart = idx;
        }
        if (issue.end_idx - 1 < chars.length && issue.end_idx > 0) {
          chars[issue.end_idx - 1].issueEnd = idx;
        }
      }
    }

    // Build output HTML character by character
    let result = "";
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];

      if (c.issueStart !== null) {
        const issue = issues[c.issueStart];
        const cls = `promptly-mark promptly-${issue.category.toLowerCase()}`;
        result += `<mark class="${cls}" data-issue-idx="${c.issueStart}">`;
      }

      result += escapeHtml(c.char);

      if (c.issueEnd !== null) {
        result += "</mark>";
      }
    }

    mirrorEl.innerHTML = result;

    // Sync scroll position
    mirrorEl.scrollTop = textarea.scrollTop;
    mirrorEl.scrollLeft = textarea.scrollLeft;

    // Bind click events on marks
    mirrorEl.querySelectorAll(".promptly-mark").forEach((mark) => {
      mark.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(mark.getAttribute("data-issue-idx"), 10);
        if (issues[idx]) {
          showTooltip(issues[idx], mark.getBoundingClientRect());
        }
      });
    });
  }

  // ─── Scroll Sync ──────────────────────────────────────────────────
  function setupScrollSync(textarea) {
    if (!mirrorEl) return;

    // Sync mirror scroll with textarea scroll
    const textareaHandler = () => {
      if (mirrorEl) {
        mirrorEl.scrollTop = textarea.scrollTop;
        mirrorEl.scrollLeft = textarea.scrollLeft;
      }
    };
    textarea.addEventListener("scroll", textareaHandler);
    scrollListeners.push({ el: textarea, handler: textareaHandler });

    // Reposition on ancestor scroll (page scroll, container scroll)
    const reposition = () => {
      positionPill(textarea);
      positionMirror(textarea);
    };

    let ancestor = textarea.parentElement;
    while (ancestor && ancestor !== document.documentElement) {
      const handler = reposition;
      ancestor.addEventListener("scroll", handler, { passive: true });
      scrollListeners.push({ el: ancestor, handler });
      ancestor = ancestor.parentElement;
    }
    window.addEventListener("scroll", reposition, { passive: true });
    scrollListeners.push({ el: window, handler: reposition });
  }

  // ─── Tooltip Popover ──────────────────────────────────────────────
  function showTooltip(issue, anchorRect) {
    hideTooltip();

    tooltipEl = document.createElement("div");
    tooltipEl.className = "promptly-tooltip";

    const categoryColors = {
      Clarity: { bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.4)", text: "#f87171", label: "Clarity" },
      Context: { bg: "rgba(59,130,246,0.1)", border: "rgba(59,130,246,0.4)", text: "#60a5fa", label: "Context" },
      Constraints: { bg: "rgba(34,197,94,0.1)", border: "rgba(34,197,94,0.4)", text: "#4ade80", label: "Constraints" },
    };
    const color = categoryColors[issue.category] || categoryColors.Clarity;

    tooltipEl.style.borderColor = color.border;

    // Build suggestion HTML
    let suggestionHtml = "";
    if (issue.suggestion && issue.suggestion.trim()) {
      suggestionHtml = `
        <div class="promptly-tooltip-suggestion promptly-suggestion-glow">
          <div class="promptly-tooltip-suggestion-label">SUGGESTED OPTIMIZATION:</div>
          <div class="promptly-tooltip-suggestion-text">${escapeHtml(issue.suggestion)}</div>
        </div>
        <button class="promptly-tooltip-accept" data-start="${issue.start_idx}" data-end="${issue.end_idx}">
          ✦ Accept Optimization
        </button>
      `;
    } else {
      suggestionHtml = `
        <div class="promptly-tooltip-suggestion promptly-no-suggestion">
          <div class="promptly-tooltip-suggestion-label">SUGGESTION:</div>
          <div class="promptly-tooltip-suggestion-text promptly-no-suggestion-text">
            Try adding more context — specify the role, audience, format, and constraints for better results.
          </div>
        </div>
      `;
    }

    tooltipEl.innerHTML = `
      <div class="promptly-tooltip-header">
        <span class="promptly-tooltip-category" style="background:${color.bg};color:${color.text};border-color:${color.border}">
          ${color.label}
        </span>
        <button class="promptly-tooltip-close">&times;</button>
      </div>
      <p class="promptly-tooltip-desc">${escapeHtml(issue.description)}</p>
      ${suggestionHtml}
    `;

    // Position tooltip using fixed coordinates (no scrollY/X needed)
    let top = anchorRect.bottom + 8;
    let left = Math.max(12, Math.min(window.innerWidth - 330, anchorRect.left));

    // Flip above if not enough space below
    if (top + 200 > window.innerHeight) {
      top = anchorRect.top - 8 - 200;
      if (top < 12) top = 12;
    }

    tooltipEl.style.position = "fixed";
    tooltipEl.style.top = top + "px";
    tooltipEl.style.left = left + "px";
    tooltipEl.style.zIndex = "2147483647";

    document.body.appendChild(tooltipEl);

    // Event: Close
    tooltipEl.querySelector(".promptly-tooltip-close").addEventListener("click", (e) => {
      e.stopPropagation();
      hideTooltip();
    });

    // Event: Accept Optimization
    const acceptBtn = tooltipEl.querySelector(".promptly-tooltip-accept");
    if (acceptBtn) {
      acceptBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        applyFix(activeTextarea, issue);
        hideTooltip();
      });
    }
  }

  function hideTooltip() {
    if (tooltipEl) {
      tooltipEl.remove();
      tooltipEl = null;
    }
  }

  // ─── Accept Optimization — React State Sync ───────────────────────
  function applyFix(textarea, issue) {
    if (!textarea) return;

    const currentText = getText(textarea);
    const newText =
      currentText.slice(0, issue.start_idx) +
      issue.suggestion +
      currentText.slice(issue.end_idx);

    if (textarea.tagName === "TEXTAREA" || textarea.tagName === "INPUT") {
      // React-controlled input: bypass React's value setter
      const proto = textarea.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) {
        setter.call(textarea, newText);
      } else {
        textarea.value = newText;
      }
    } else {
      // contenteditable div (ChatGPT, Claude, Gemini)
      // Use execCommand to go through the browser's editing pipeline
      // so framework event listeners (React, Svelte) detect the change
      textarea.focus();
      try {
        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(textarea);
        selection.removeAllRanges();
        selection.addRange(range);
        document.execCommand("insertText", false, newText);
      } catch (e) {
        // Fallback: set innerHTML with paragraph wrapping
        console.warn("[Promptly] execCommand failed, using fallback:", e);
        textarea.innerHTML = "<p>" + escapeHtml(newText) + "</p>";
      }
    }

    // Dispatch native events so React/Svelte recognizes the change
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    textarea.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));

    // Cascade: clear current issues, re-trigger analysis immediately
    currentIssues = [];
    updatePillBadge(0);
    renderMirror(textarea, []);

    if (window.promptlyTriggerImmediate) {
      window.promptlyTriggerImmediate(newText);
    }
  }

  // ─── Attach Widget to Textarea ────────────────────────────────────
  window.promptlyAttachWidget = function (textarea) {
    // If re-attaching to same element, skip
    if (activeTextarea === textarea && pillEl && document.body.contains(pillEl)) return;

    // Clean up previous attachment
    cleanup();

    activeTextarea = textarea;

    // Create elements (attached to document.body)
    createPill();
    createMirror();

    // Initial positioning
    positionPill(textarea);
    positionMirror(textarea);

    // Set up scroll sync
    setupScrollSync(textarea);

    // Continuous position tracking — handles page scroll, resize, dynamic layout
    positionInterval = setInterval(() => {
      if (!activeTextarea || !document.contains(activeTextarea)) {
        cleanup();
        return;
      }
      positionPill(activeTextarea);
      positionMirror(activeTextarea);
    }, 250);

    console.log("[Promptly] Widget attached.");
  };

  // If content.js ran first and already detected a textarea, attach to it now
  if (window.promptlyActiveTextarea) {
    window.promptlyAttachWidget(window.promptlyActiveTextarea);
  }

  // ─── Render Issues (called by content.js) ─────────────────────────
  window.promptlyRenderIssues = function (issues, warning) {
    currentIssues = issues || [];
    updatePillBadge(currentIssues.length);

    if (activeTextarea) {
      positionMirror(activeTextarea);
      renderMirror(activeTextarea, currentIssues);
    }

    if (warning) {
      console.warn("[Promptly]", warning);
    }
  };

  // ─── Global Click Dismiss ─────────────────────────────────────────
  document.addEventListener("click", (e) => {
    if (tooltipEl && !tooltipEl.contains(e.target) && !e.target.closest(".promptly-mark") && !e.target.closest(".promptly-pill")) {
      hideTooltip();
    }
  });

})();
