/**
 * medRxiv / bioRxiv API client
 * Docs: https://api.biorxiv.org/
 * No API key required
 */

import type { SearchPaper, ConceptNode } from '../literatureSearchTypes'

const RXIV_BASE = 'https://api.biorxiv.org/details'

interface RxivPaper {
  doi: string
  title: string
  authors: string
  date: string
  version: string
  type: string
  category: string
  abstract: string
  server: string
}

interface RxivResponse {
  messages: Array<{ status: string; count: string; total: string }>
  collection: RxivPaper[]
}

function normalizeRxivPaper(paper: RxivPaper): SearchPaper {
  const authors = paper.authors
    ? paper.authors.split(';').map(a => a.trim()).filter(Boolean)
    : []
  const year = paper.date ? parseInt(paper.date.slice(0, 4)) : undefined

  const concepts: ConceptNode[] = []
  if (paper.category) {
    concepts.push({ id: 'rxiv:category:' + paper.category, displayName: paper.category, level: 0 })
  }

  return {
    id: paper.doi,
    openAlexId: '',
    title: paper.title || '',
    abstract: paper.abstract || '',
    abstractSnippet: paper.abstract ? paper.abstract.slice(0, 220) : '',
    authors,
    authorIds: [],
    year,
    publicationDate: paper.date,
    venue: paper.server === 'medrxiv' ? 'medRxiv' : 'bioRxiv',
    doi: paper.doi,
    url: 'https://doi.org/' + paper.doi,
    pdfUrl: 'https://www.' + paper.server + '.org/content/' + paper.doi + 'v' + (paper.version || '1') + '.full.pdf',
    citedByCount: 0,
    isOpenAccess: true,
    oaStatus: 'gold',
    sourceType: 'repository',
    concepts,
    topics: paper.category ? [paper.category] : [],
    keywordMatches: [],
    matchedQueries: [],
    matchedConcepts: [],
    relevanceScore: 0,
    citationScore: 0,
    noveltyScore: year ? Math.min(1, Math.max(0, (year - 2015) / 10)) : 0.5,
    openAccessScore: 1,
    finalScore: 0,
  }
}

export interface RxivSearchParams {
  query: string
  maxResults?: number
  server?: 'medrxiv' | 'biorxiv'
  startDate?: string
  endDate?: string
  signal?: AbortSignal
}

export async function searchRxiv(params: RxivSearchParams): Promise<SearchPaper[]> {
  const { query, maxResults = 10, server = 'medrxiv', startDate, endDate, signal } = params

  const end = endDate || new Date().toISOString().slice(0, 10)
  const start = startDate || (() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 6)
    return d.toISOString().slice(0, 10)
  })()

  const url = RXIV_BASE + '/' + server + '/' + start + '/' + end + '/0/' + Math.min(maxResults * 3, 100)
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('Rxiv API error: ' + response.status)

  const data = await response.json() as RxivResponse
  const papers = (data.collection || []).map(normalizeRxivPaper)

  const queryLower = query.toLowerCase()
  const queryTokens = queryLower.split(/\s+/).filter(t => t.length > 1)

  return papers
    .map(paper => {
      const text = (paper.title + ' ' + paper.abstract).toLowerCase()
      const matchCount = queryTokens.filter(token => text.includes(token)).length
      return { paper, matchCount }
    })
    .filter(item => item.matchCount > 0)
    .sort((a, b) => b.matchCount - a.matchCount)
    .slice(0, maxResults)
    .map(item => item.paper)
}

export async function getRxivPaperByDOI(
  doi: string,
  server: 'medrxiv' | 'biorxiv' = 'medrxiv',
  signal?: AbortSignal,
): Promise<SearchPaper | null> {
  try {
    const url = RXIV_BASE + '/' + server + '/' + doi
    const response = await fetch(url, { signal })
    if (!response.ok) return null
    const data = await response.json() as RxivResponse
    if (!data.collection?.length) return null
    return normalizeRxivPaper(data.collection[0])
  } catch {
    return null
  }
}
