export function slugify(text: string): string
export function createSlugger(): (text: string) => string
export function rewriteHref(href: string, page: { src: string; out: string }): string
