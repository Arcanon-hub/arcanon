/**
 * keyboard.js — Document-level keyboard shortcuts for the graph UI.
 *
 * Shortcuts:
 *   F     → fit all nodes to screen (delegates to #fit-btn click)
 *   Esc   → deselect selected node and close detail panel
 *   /     → focus the #search input
 *
 * Guard: shortcuts are skipped when the active element is an <input>,
 * <textarea>, or <select> so they do not interfere with typing.
 */

import { state } from "./state.js";
import { hideDetailPanel } from "./detail-panel.js";
import { render } from "./renderer.js";

let _wired = false;

function onKeyDown(e) {
  // Skip when user is typing in a form control
  const tag = document.activeElement?.tagName?.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

  switch (e.key) {
    case 'f':
    case 'F': {
      e.preventDefault();
      document.getElementById('fit-btn')?.click();
      break;
    }
    case 'Escape': {
      if (state.selectedNodeId !== null || state.isolatedNodeId !== null) {
        state.selectedNodeId = null;
        state.isolatedNodeId = null;
        state.isolationDepth = 1;
        hideDetailPanel();
        render();
      }
      break;
    }
    case 'i':
    case 'I': {
      if (state.isolatedNodeId !== null) {
        // Exit isolation — pressing I again while isolated
        state.isolatedNodeId = null;
        state.isolationDepth = 1;
      } else if (state.selectedNodeId !== null) {
        // Enter isolation for the currently selected node
        state.isolatedNodeId = state.selectedNodeId;
        state.isolationDepth = 1;
      }
      render();
      break;
    }
    case '2': {
      if (state.isolatedNodeId !== null) {
        state.isolationDepth = 2;
        render();
      }
      break;
    }
    case '3': {
      if (state.isolatedNodeId !== null) {
        state.isolationDepth = 3;
        render();
      }
      break;
    }
    case '/': {
      e.preventDefault();
      document.getElementById('search')?.focus();
      break;
    }
  }
}

/**
 * Wire the keyboard handler exactly once.
 * Safe to call multiple times (e.g. on every loadProject).
 */
export function initKeyboard() {
  if (_wired) return;
  document.addEventListener('keydown', onKeyDown);
  _wired = true;
}
