import { onBeforeUnmount, ref } from 'vue'

/**
 * State for a small menu anchored under a trigger button. The menu is meant to
 * be teleported to <body> and positioned `fixed` from `pos`, so a scrolling or
 * overflow-clipped parent can't cut it off. It closes on an outside press, on
 * Esc, and on any scroll or resize (its anchor would otherwise drift).
 */
export function usePopover(width = 240) {
  const open = ref(false)
  const trigger = ref<HTMLElement | null>(null)
  const menu = ref<HTMLElement | null>(null)
  const pos = ref({ top: 0, left: 0 })

  function onPress(e: Event): void {
    const t = e.target as Node
    if (menu.value?.contains(t) || trigger.value?.contains(t)) return
    close()
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
  }

  function show(): void {
    const r = trigger.value?.getBoundingClientRect()
    if (!r) return
    pos.value = { top: r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) }
    open.value = true
    document.addEventListener('mousedown', onPress, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
  }

  function close(): void {
    open.value = false
    document.removeEventListener('mousedown', onPress, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', close)
    window.removeEventListener('scroll', close, true)
  }

  function toggle(): void {
    if (open.value) close()
    else show()
  }

  onBeforeUnmount(close)
  return { open, trigger, menu, pos, toggle, close }
}
