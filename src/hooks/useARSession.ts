import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Product } from '../types/product'
import { AR_INITIAL_STATE, ARSessionManager } from '../services/ar/arSessionManager'

const noopSubscribe = () => () => undefined
const getIdle = () => AR_INITIAL_STATE

/**
 * Owns one ARSessionManager per mount (or per restart). React only re-renders on coarse
 * state changes; all per-frame tracking work stays inside the manager.
 */
export function useARSession(initialProduct: Product) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  /** The viewer root: kept on screen over native AR as its DOM overlay. */
  const rootRef = useRef<HTMLDivElement>(null)
  const productRef = useRef(initialProduct)
  const [manager, setManager] = useState<ARSessionManager | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    const surface = surfaceRef.current
    const root = rootRef.current
    if (!canvas || !surface || !root) return
    const session = new ARSessionManager()
    setManager(session)
    void session.start(canvas, surface, root, productRef.current)
    return () => session.dispose()
  }, [attempt])

  const state = useSyncExternalStore(manager?.subscribe ?? noopSubscribe, manager?.getState ?? getIdle)

  // Remember the latest product so a restart resumes with what the user last chose.
  useEffect(() => {
    if (state.product) productRef.current = state.product
  }, [state.product])

  const restart = useCallback(() => setAttempt((n) => n + 1), [])

  // `attempt` keys the canvas so each restart gets a fresh WebGL context.
  return { canvasRef, surfaceRef, rootRef, state, session: manager, restart, attempt }
}
