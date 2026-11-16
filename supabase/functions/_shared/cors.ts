/**
 * ============================================================================
 * cors.ts — Cross-Origin Resource Sharing (CORS) Configuration
 * 
 * VIVA EXAM EXPLANATION:
 * This module secures Supabase Edge Functions across environments:
 * 1. Allows local development servers (localhost:5173 / 127.0.0.1:5173).
 * 2. Checks and permits deployed frontend production origin and preview URLs (Vercel).
 * 3. Enforces standard HTTP security headers (OPTIONS preflight handling, Vary: Origin).
 * ============================================================================
 */

const localOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173']

/**
 * Returns the CORS response headers appropriate for the incoming request origin.
 */
export function corsHeaders(request: Request): HeadersInit {
  const origin = request.headers.get('Origin')
  const exactOrigins = [
    ...localOrigins,
    ...(Deno.env.get('CORS_ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean),
    Deno.env.get('FRONTEND_PRODUCTION_ORIGIN') || '',
  ]
  let allowed = Boolean(origin && exactOrigins.includes(origin))

  // Allow dynamically generated Vercel preview deployment URLs matching project slug
  const projectSlug = Deno.env.get('VERCEL_PROJECT_SLUG')?.toLowerCase()
  if (origin && projectSlug) {
    try {
      const parsed = new URL(origin)
      allowed ||= parsed.protocol === 'https:'
        && parsed.hostname.endsWith('.vercel.app')
        && parsed.hostname.startsWith(`${projectSlug}-`)
    } catch { /* malformed origins are not allowed */ }
  }

  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-notification-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
  if (allowed && origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}
