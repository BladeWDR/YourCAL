import { config } from '../config.js'

/**
 * Adds the outbound request timeout to a fetch `init`, combined with any
 * signal the caller already supplied.
 */
export function withTimeout(init?: RequestInit): RequestInit {
  const timeout = AbortSignal.timeout(config.outboundTimeoutMs)
  return { ...init, signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout }
}
