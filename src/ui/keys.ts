/**
 * True if a keyboard shortcut should NOT fire for this event: modifier chords (Cmd/Ctrl+C is
 * copy, not "Classic"), typing into text fields or an open select, and Space/Enter on a
 * focused control (they activate it). Letter shortcuts still work after clicking a slider or
 * button (the panel also hands focus back after use).
 */
export function ignoreShortcut(e: KeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return true
  const t = e.target as HTMLElement | null
  if (!t || t === document.body) return false
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
  if (t.tagName === 'INPUT' && !['range', 'checkbox', 'button'].includes((t as HTMLInputElement).type)) return true
  if (['INPUT', 'BUTTON'].includes(t.tagName) && (e.code === 'Space' || e.key === 'Enter')) return true
  return false
}
