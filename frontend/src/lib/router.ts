import { useEffect, useState } from 'react'

/** Hash routing (`#/offer`): needs no server-side fallback and keeps the browser back button working. */
function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/, '')
}

export function useRoute(): string {
  const [route, setRoute] = useState(currentRoute)
  useEffect(() => {
    const onChange = () => {
      setRoute(currentRoute())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export const routeHref = (route: string) => `#/${route}`
