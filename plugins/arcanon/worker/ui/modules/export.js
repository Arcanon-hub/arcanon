/**
 * export.js — PNG export for the graph canvas.
 *
 * Wires a click handler on #export-btn that calls canvas.toDataURL('image/png')
 * and triggers a browser download named "ligamen-graph.png".
 */

let _wired = false;

/**
 * Wire the export button click handler exactly once.
 * Safe to call on every loadProject (idempotent).
 */
export function initExport() {
  if (_wired) return;

  const btn = document.getElementById('export-btn');
  if (!btn) return;

  btn.addEventListener('click', () => {
    const canvas = document.getElementById('graph-canvas');
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = 'ligamen-graph.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  });

  _wired = true;
}
