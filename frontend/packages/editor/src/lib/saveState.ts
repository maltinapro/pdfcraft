import { useEffect, useState } from 'react'

/** Whether the host has stored the latest edit; shown in the editor footer. */
export type SaveState = 'saving' | 'saved' | 'error'

/**
 * Saves after a pause in editing (when one of `deps` changed) and reports the state for `PaperEditor`'s `saveState`.
 * `save` returns whether storing worked. Use it with the host's own storage or API.
 */
export function useAutosave(deps: readonly unknown[], save: () => boolean | Promise<boolean>, delayMs = 400): SaveState {
  const [state, setState] = useState<SaveState>('saved')
  useEffect(() => {
    setState('saving')
    let current = true
    const timer = window.setTimeout(() => {
      void Promise.resolve(save()).then(
        (ok) => current && setState(ok ? 'saved' : 'error'),
        () => current && setState('error'),
      )
    }, delayMs)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
    // `save` is a fresh closure on every render; `deps` decide when to run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [delayMs, ...deps])
  return state
}
