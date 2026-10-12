/**
 * True if a keyboard shortcut should NOT fire for this event: modifier chords (Cmd/Ctrl+C is
 * copy, not "Classic") and keys typed into form controls (a focused select jumps by letter).
 */
export function ignoreShortcut(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true
  const t = e.target as HTMLElement | null
  if (!t) return false
  return t.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(t.tagName)
}
