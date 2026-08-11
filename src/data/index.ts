import { createLocalAdapter } from './adapters/local/LocalAdapter'
import { createSupabaseAdapter } from './adapters/supabase/SupabaseAdapter'
import type { DataPort } from './ports'

export type { DataPort }
export * from './ports'

/**
 * Adapter selection happens exactly once, here, driven by env var.
 * VITE_DATA_ADAPTER=local (default) | supabase
 */
let instance: DataPort | null = null

export function dataPort(): DataPort {
  if (!instance) {
    const which = import.meta.env.VITE_DATA_ADAPTER ?? 'local'
    instance =
      which === 'supabase'
        ? createSupabaseAdapter()
        : createLocalAdapter()
  }
  return instance
}

/** Test seam: swap the port (unit tests, storybook-style demos). */
export function setDataPort(port: DataPort): void {
  instance = port
}
