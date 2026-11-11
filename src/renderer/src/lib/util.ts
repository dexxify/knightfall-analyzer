export function isLocalProvider(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase()
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]' || h.endsWith('.localhost')
  } catch {
    return true
  }
}
