const pendingScripts = new Map<string, Promise<void>>()

export function loadScript(src: string, globalCheck?: () => unknown): Promise<void> {
  if (globalCheck && globalCheck()) return Promise.resolve()
  const existing = pendingScripts.get(src)
  if (existing) return existing

  const promise = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`))
    document.head.appendChild(script)
  })

  pendingScripts.set(src, promise)
  return promise
}
