import { useEffect } from 'react'

const THRESHOLD = 12
const MIN_OFFSET = 80

/** Mobile list pages: hide the bottom navigation while scrolling down, show it again when scrolling up or near the ends. */
export function useHideNavOnScroll() {
  useEffect(() => {
    const compact = window.matchMedia('(max-width: 839px)')
    const root = document.documentElement
    let last = window.scrollY
    let frame = 0
    const update = () => {
      frame = 0
      if (!compact.matches) {
        root.removeAttribute('data-nav-hidden')
        return
      }
      const y = Math.max(0, window.scrollY)
      const max = document.documentElement.scrollHeight - window.innerHeight
      if (y < MIN_OFFSET || y >= max - 4 || last - y > THRESHOLD) {
        root.removeAttribute('data-nav-hidden')
        last = y
      } else if (y - last > THRESHOLD) {
        root.setAttribute('data-nav-hidden', '')
        last = y
      }
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
      root.removeAttribute('data-nav-hidden')
    }
  }, [])
}
