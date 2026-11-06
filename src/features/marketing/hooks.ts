import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

/**
 * Marketing-only motion helpers. Every one of them degrades to "no motion"
 * under `prefers-reduced-motion`, which is the contract the brief sets: reduce
 * parallax, 3D auto-rotation, video and counters to static.
 */

/** True when the visitor asked the OS to reduce motion. Reactive to changes. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches
  })

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onChange = () => setReduced(mq.matches)
    onChange()
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])

  return reduced
}

/** True once the window has scrolled past `threshold` px. Used for the navbar. */
export function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined") return
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [threshold])

  return scrolled
}

interface RevealOptions {
  threshold?: number
  rootMargin?: string
  once?: boolean
}

interface RevealResult {
  ref: RefObject<HTMLDivElement | null>
  visible: boolean
}

/**
 * Scroll reveal. Attach `ref` to the element; `visible` flips true once it
 * enters the viewport, then stays true. Under reduced motion (or when the
 * observer is unavailable) it reports visible immediately so nothing is hidden.
 */
export function useReveal(options?: RevealOptions): RevealResult {
  const ref = useRef<HTMLDivElement | null>(null)
  const reduced = usePrefersReducedMotion()
  const [visible, setVisible] = useState(reduced)
  const once = options?.once ?? true

  useEffect(() => {
    if (reduced) {
      setVisible(true)
      return
    }
    const el = ref.current
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (!entry) return
        if (entry.isIntersecting) {
          setVisible(true)
          if (once) observer.disconnect()
        } else if (!once) {
          setVisible(false)
        }
      },
      {
        threshold: options?.threshold ?? 0.15,
        rootMargin: options?.rootMargin ?? "0px 0px -10% 0px",
      },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [reduced, once, options])

  return { ref, visible }
}

/**
 * Animated integer counter. Starts when `active` is true. Reduced motion jumps
 * straight to the target; a non-integer target is rounded for display.
 */
export function useCountUp(target: number, active: boolean, durationMs = 1400) {
  const reduced = usePrefersReducedMotion()
  const [value, setValue] = useState(0)
  const frame = useRef<number | null>(null)

  useEffect(() => {
    if (!active) return
    if (reduced) {
      setValue(target)
      return
    }
    let start: number | null = null
    const step = (now: number) => {
      if (start === null) start = now
      const progress = Math.min(1, (now - start) / durationMs)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(target * eased))
      if (progress < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [active, reduced, target, durationMs])

  return value
}

/**
 * Pointer parallax offset in the range [-1, 1] per axis, or zeros on touch /
 * coarse-pointer devices and whenever reduced motion is on. Feeds the hero tilt.
 */
export function useParallax(enabled: boolean) {
  const reduced = usePrefersReducedMotion()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const onMove = useCallback(
    (event: PointerEvent) => {
      const nx = (event.clientX / window.innerWidth) * 2 - 1
      const ny = (event.clientY / window.innerHeight) * 2 - 1
      setOffset({ x: nx, y: ny })
    },
    [],
  )

  useEffect(() => {
    if (!enabled || reduced || typeof window === "undefined") {
      setOffset({ x: 0, y: 0 })
      return
    }
    const coarse =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches
    if (coarse) return
    window.addEventListener("pointermove", onMove, { passive: true })
    return () => window.removeEventListener("pointermove", onMove)
  }, [enabled, reduced, onMove])

  return reduced || !enabled ? { x: 0, y: 0 } : offset
}
