/**
 * Shared agent resolution (single source of truth).
 *
 * STOP_WORDS / filterStopWords / resolveAgent were duplicated across the
 * plugin, the test runner, and the toolkit; the scoring fix had to be copied
 * by hand in each copy. This module is the one place they live.
 *
 * matchSkills intentionally stays per-consumer: the plugin uses a phase-aware,
 * canonical-skill variant; the runner/toolkit use a simple trigger-score
 * variant. Do not unify them without aligning their contracts.
 */

export const STOP_WORDS = new Set([
  // English
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for", "of", "with", "by",
  "from", "as", "is", "was", "are", "were", "be", "been", "being", "have", "has", "had",
  "do", "does", "did", "will", "would", "could", "should", "may", "might", "must",
  "can", "shall", "this", "that", "these", "those", "i", "you", "he", "she", "it",
  "we", "they", "me", "him", "her", "us", "them", "my", "your", "his", "its", "our",
  "their", "what", "which", "who", "when", "where", "why", "how", "all", "any",
  "both", "each", "few", "more", "most", "other", "some", "such", "no", "nor",
  "not", "only", "own", "same", "so", "than", "too", "very", "just", "also",
  // Generic project/product tokens with no agent-domain signal
  "odoo",
  // Spanish
  "el", "la", "los", "las", "un", "una", "unos", "unas", "y", "o", "pero", "en",
  "de", "con", "por", "para", "desde", "hasta", "entre", "sobre", "bajo", "ante",
  "sin", "según", "durante", "mediante", "excepto", "salvo", "hacia", "a", "al",
  "del", "lo", "le", "les", "se", "es", "son", "está", "están", "fue", "fueron",
  "ser", "sido", "siendo", "haber", "han", "había", "tener", "tiene", "tienen",
  "tuvo", "hacer", "hace", "hacen", "hizo", "este", "esta", "estos", "estas",
  "ese", "esa", "esos", "esas", "aquel", "aquella", "aquellos", "aquellas",
  "yo", "tú", "él", "ella", "nosotros", "nosotras", "vosotros", "vosotras",
  "ellos", "ellas", "mí", "ti", "sí", "conmigo", "contigo", "mío", "mía",
  "míos", "mías", "tuyo", "tuya", "suyo", "suya", "nuestro", "nuestra",
  "nuestros", "nuestras", "vuestro", "vuestra", "suyos", "suyas",
  "que", "cual", "cuales", "quien", "quienes", "cuyo", "cuya", "cuyos",
  "cuyas", "donde", "cuando", "como", "qué", "cuál", "cuáles", "quién", "quiénes", "cuándo", "dónde", "cómo",
  "porqué", "cuánto", "cuánta", "cuántos", "cuántas", "todo", "toda",
  "todos", "todas", "cada", "alguno", "alguna", "algunos", "algunas",
  "ninguno", "ninguna", "otro", "otra", "otros", "otras", "mismo", "misma",
  "mismos", "mismas", "tal", "tales", "tan", "tanto", "tanta", "tantos",
  "tantas", "muy", "poco", "poca", "pocos", "pocas", "más", "menos",
  "mucho", "mucha", "muchos", "muchas", "demasiado", "demasiada",
  "sólo", "solo", "solamente", "ya", "aún", "todavía", "siempre",
  "nunca", "jamás", "ahora", "antes", "después", "luego", "pronto",
  "tarde", "temprano", "ayer", "hoy", "mañana", "aquí", "ahí", "allí",
  "donde", "cuando", "como", "que", "quien", "cuyo", "cuya", "cuyos",
  "cuyas", "cual", "cuales", "cuanto", "cuanta", "cuantos", "cuantas",
])

export function filterStopWords(keywords) {
  return keywords.filter(kw => {
    const lower = kw.toLowerCase().trim()
    if (!lower || lower.length < 3) return false
    if (STOP_WORDS.has(lower)) return false
    if (/^\d+$/.test(lower)) return false
    return true
  })
}

export const DEFAULT_AGENTS = {
  PROPOSE: "odoo_proposer",
  ASSESS: "odoo_functional_consultant",
  "QA-PLAN": "odoo_qa_engineer",
  DESIGN: "odoo_backend_engineer",
  IMPLEMENT: "odoo_backend_engineer",
  VERIFY: "odoo_qa_engineer",
  EXPLORE: "odoo_functional_consultant",
  FIX: "odoo_backend_engineer",
}

const FIXED_PHASES = new Set(["PROPOSE", "ASSESS", "QA-PLAN", "VERIFY", "EXPLORE"])
const DOMAIN_PHASES = new Set(["DESIGN", "IMPLEMENT", "FIX"])

function phaseEligible(agent, phase) {
  return agent?.installed === true && (
    agent.phases?.includes(phase) || agent.phases?.includes("ANY")
  )
}

/** Validate an explicit agent without ever treating registry metadata as optional. */
export function validateAgentSelection(registry, phase, agentName) {
  const name = typeof agentName === "string" ? agentName.trim() : ""
  const agent = (Array.isArray(registry?.agents) ? registry.agents : []).find(candidate => candidate?.name === name)
  if (!agent) return { valid: false, reason: "agent-not-registered", agent: null }
  if (agent.installed !== true) return { valid: false, reason: "agent-not-installed", agent: null }
  if (!phaseEligible(agent, phase)) return { valid: false, reason: "agent-phase-ineligible", agent: null }
  return { valid: true, reason: null, agent }
}

/**
 * Score-based agent resolution: count keyword hits per agent description and
 * pick the highest; ties keep registry order. A single generic token (e.g.
 * "odoo") can never outvote a strongly matching domain agent. Agents with
 * routing_triggers are eligible only when the task contains one of them.
 */
export function resolveAgent(registry, phase, taskKeywords) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_AGENTS, phase)) return null

  const defaultSelection = validateAgentSelection(registry, phase, DEFAULT_AGENTS[phase])
  if (FIXED_PHASES.has(phase)) return defaultSelection.valid ? defaultSelection.agent.name : null

  const filteredKeywords = filterStopWords(Array.isArray(taskKeywords) ? taskKeywords : [])
  if (filteredKeywords.length === 0) {
    return DOMAIN_PHASES.has(phase) && phase !== "FIX"
      ? (defaultSelection.valid ? defaultSelection.agent.name : null)
      : null
  }

  let best = null
  const keywordText = filteredKeywords.join(" ").toLowerCase()
  for (const agent of (Array.isArray(registry?.agents) ? registry.agents : [])) {
    if (!phaseEligible(agent, phase)) continue
    const routingTriggers = Array.isArray(agent.routing_triggers) ? agent.routing_triggers : []
    if (
      routingTriggers.length > 0 &&
      !routingTriggers.some(trigger => keywordText.includes(String(trigger).toLowerCase()))
    ) continue

    const descLower = `${String(agent.name || "")} ${String(agent.description || "")}`.toLowerCase()
    let score = 0
    for (const kw of filteredKeywords) {
      if (descLower.includes(kw.toLowerCase())) score++
    }
    if (score > 0 && (!best || score > best.score)) best = { name: agent.name, score }
  }
  if (best) return best.name
  return phase === "FIX" ? null : (defaultSelection.valid ? defaultSelection.agent.name : null)
}
