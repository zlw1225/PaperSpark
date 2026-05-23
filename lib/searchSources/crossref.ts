/**
 * CrossRef API client
 * Docs: https://api.crossref.org/swagger-ui/index.html
 * No API key required (polite pool with email)
 */

import type { SearchPaper, ConceptNode } from '../literatureSearchTypes'

const CROSSREF_BASE = 'https://api.crossref.org'
const CROSSREF_EMAIL = process.env.CROSSREF_EMAIL || ''
const CROSSREF_API_KEY = process.env.CROSSREF_API_KEY || ''

interface CrossRefWork {
  DOI: string
  title: string[]
  abstract?: string
  author?: Array<{ given?: string; family?: string }>
  'published-print'?: { 'date-parts': number[][] }
  'published-online'?: { 'date-parts': number[][] }
  'container-title': string[]
  type: string
  is_referenced_by_count: number
  link?: Array<{ URL: string; 'content-type': string }>
  license?: Array<{ URL: string }>
  subject?: string[]
  publisher: string
  URL: string
  score?: number
}

interface CrossRefResponse {
  status: string
  message: { 'total-results': number; items: CrossRefWork[] }
}

function crossrefFetch<T>(path: string, params: Record<string, string> = {}, signal?: AbortSignal): Promise<T> {
  const url = new URL(CROSSREF_BASE + path)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  if (CROSSREF_EMAIL) url.searchParams.set('mailto', CROSSREF_EMAIL)

  const headers: Record<string, string> = {}
  if (CROSSREF_API_KEY) headers['Crossref-Plus-API-Token'] = CROSSREF_API_KEY

  return fetch(url.toString(), { headers, signal }).then(async res => {
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error('CrossRef API error ' + res.status + ': ' + text)
    }
    return res.json() as Promise<T>
  })
}

function getYearFromParts(parts?: number[][]): number | undefined {
  if (!parts?.length || !parts[0]?.length) return undefined
  return parts[0][0]
}

function getDateFromParts(parts?: number[][]): string | undefined {
  if (!parts?.length || !parts[0]?.length) return undefined
  const [y, m, d] = parts[0]
  if (!y) return undefined
  if (m && d) return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0')
  if (m) return y + '-' + String(m).padStart(2, '0')
  return String(y)
}

function normalizeCrossRefWork(work: CrossRefWork): SearchPaper {
  const authors = (work.author || []).map(a => [a.given, a.family].filter(Boolean).join(' '))
  const dateParts = work['published-print']?.['date-parts'] || work['published-online']?.['date-parts']
  const year = getYearFromParts(dateParts)
  const publicationDate = getDateFromParts(dateParts)

  const concepts: ConceptNode[] = (work.subject || []).slice(0, 5).map(s => ({
    id: 'crossref:subject:' + s, displayName: s, level: 0,
  }))

  const pdfLink = work.link?.find(l => l['content-type'] === 'application/pdf')

  return {
    id: work.DOI,
    openAlexId: '',
    title: (work.title || [])[0] || '',
    abstract: work.abstract ? work.abstract.replace(/<[^>]+>/g, '') : '',
    abstractSnippet: work.abstract ? work.abstract.replace(/<[^>]+>/g, '').slice(0, 220) : '',
    authors,
    authorIds: [],
    year,
    publicationDate,
    venue: (work['container-title'] || [])[0] || work.publisher || '',
    doi: work.DOI,
    url: work.URL || 'https://doi.org/' + work.DOI,
    pdfUrl: pdfLink?.URL,
    citedByCount: work.is_referenced_by_count || 0,
    isOpenAccess: work.license?.some(l => /creativecommons|open/.test(l.URL)) || false,
    oaStatus: 'closed',
    sourceType: work.type?.includes('journal') ? 'journal' : 'conference',
    concepts,
    topics: work.subject || [],
    keywordMatches: [],
    matchedQueries: [],
    matchedConcepts: [],
    relevanceScore: (work.score || 0) / 100,
    citationScore: 0,
    noveltyScore: year ? Math.min(1, Math.max(0, (year - 2015) / 10)) : 0.5,
    openAccessScore: 0.3,
    finalScore: 0,
  }
}

export interface CrossRefSearchParams {
  query: string
  maxResults?: number
  fromYear?: number
  toYear?: number
  type?: string
  sort?: 'relevance' | 'is-referenced-by-count' | 'deposited'
  order?: 'asc' | 'desc'
  signal?: AbortSignal
}

export async function searchCrossRef(params: CrossRefSearchParams): Promise<SearchPaper[]> {
  const { query, maxResults = 10, fromYear, toYear, type, sort = 'relevance', order = 'desc', signal } = params

  const queryParams: Record<string, string> = {
    query: query.trim(),
    rows: String(Math.min(maxResults, 100)),
    sort,
    order,
  }

  const filterParts: string[] = []
  if (fromYear) filterParts.push('from-pub-date:' + fromYear)
  if (toYear) filterParts.push('until-pub-date:' + toYear)
  if (type) filterParts.push('type:' + type)
  if (filterParts.length > 0) queryParams.filter = filterParts.join(',')

  const result = await crossrefFetch<CrossRefResponse>('/works', queryParams, signal)
  return (result.message?.items || []).map(normalizeCrossRefWork)
}

export async function getCrossRefWorkByDOI(doi: string, signal?: AbortSignal): Promise<SearchPaper | null> {
  try {
    const result = await crossrefFetch<{ message: CrossRefWork }>('/works/' + encodeURIComponent(doi), {}, signal)
    return normalizeCrossRefWork(result.message)
  } catch {
    return null
  }
}
