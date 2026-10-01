/** Removes // and /* *\/ comments from JSONC, leaving string contents alone. */
export function stripJsonComments(text: string): string {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string
    const next = text[i + 1]
    if (inString) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i++
      } else if (c === '"') inString = false
    } else if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else out += c
  }
  return out
}

/** The host of the production route's first pattern in a wrangler.jsonc text, or null. */
export function productionRouteHost(wranglerJsonc: string): string | null {
  const config = JSON.parse(stripJsonComments(wranglerJsonc).replace(/,(\s*[}\]])/g, '$1')) as {
    env?: { production?: { routes?: Array<string | { pattern?: string }> } }
  }
  const first = config.env?.production?.routes?.[0]
  const pattern = typeof first === 'string' ? first : first?.pattern
  return pattern ? pattern.replace(/^https?:\/\//, '').replace(/\/.*$/, '') : null
}

/** The host of a URL such as APP_ORIGIN, or null when it is not one. */
export function originHost(origin: string): string | null {
  try {
    return new URL(origin).host
  } catch {
    return null
  }
}
