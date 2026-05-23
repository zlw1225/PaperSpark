/**
 * Semantic Scholar API client
 * Docs: https://api.semanticscholar.org/api-docs/
 * Free tier: 100 requests/5min without key
 */

import type { SearchPaper, ConceptNode } from '../literatureSearchTypes'

const S2_BASE = 'https://api.semanticscholar.org/graph/v1'
const S2_API_KEY = process.env.SEMANTIC_SCHOLAR_API_KEY || ''

const PAPER_FIELDS = [
  'paperId', 'title', 'abstract', 'year', 'venue', 'publicationDate',
  'authors', 'externalIds', 'citationCount', 'isOpenAccess',
  'openAccessPdf', 'fieldsOfStudy', 'publicationTypes', 'tldr',
].join(',')

interface S2Author {
  authorId: string
  name: string
}

interface S2Paper {
  paperId: string
  title: string
  abstract: string | null
  year: number | null
  venue: string | null
  publicationDate: string | null
  authors: S2Author[]
  externalIds?: {
    DOI?: string | null
    ArXiv?: string | null
    PubMed?: string | null
  }
  citationCount: number | null
  isOpenAccess: boolean | null
  openAccessPdf?: { url: string; status?: string } | null
  fieldsOfStudy?: string[] | null
  publicationTypes?: string[] | null
  tldr?: { text: string } | null
}

interface S2SearchResponse {
  total: number
  offset: number
  next?: number
  data: S2Paper[]
}

function s2Fetch<T>(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(S2_BASE + path)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const headers: Record<string, string> = {}
  if (S2_API_KEY) headers['x-api-key'] = S2_API_KEY

  return fetch(url.toString(), { headers, signal }).then(async res => {
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error('Semantic Scholar API error ' + res.status + ': ' + text)
    }
    return res.json() as Promise<T>
  })
}

function normalizeS2Paper(paper: S2Paper): SearchPaper {
  const authors = paper.authors?.map(a => a.name) || []
  const authorIds = paper.authors?.map(a => a.authorId).filter(Boolean) || []
  const doi = paper.externalIds?.DOI || undefined
  const arxivId = paper.externalIds?.ArXiv || undefined

  const concepts: ConceptNode[] = (paper.fieldsOfStudy || []).map(field => ({
    id: 's2:field:' + field,
    displayName: field,
    level: 0,
  }))

  const pdfUrl = paper.openAccessPdf?.url || (arxivId ? 'https://arxiv.org/pdf/' + arxivId : undefined)

  return {
    id: paper.paperId,
    openAlexId: '',
    title: paper.title || '',
    abstract: paper.abstract || '',
    abstractSnippet: paper.tldr?.text || (paper.abstract ? paper.abstract.slice(0, 220) : ''),
    authors,
    authorIds,
    year: paper.year || undefined,
    publicationDate: paper.publicationDate || undefined,
    venue: paper.venue || '',
    doi,
    url: 'https://www.semanticscholar.org/paper/' + paper.paperId,
    pdfUrl,
    citedByCount: paper.citationCount || 0,
    isOpenAccess: paper.isOpenAccess || false,
    oaStatus: paper.isOpenAccess ? 'green' : 'closed',
    sourceType: 'journal',
    concepts,
    topics: paper.fieldsOfStudy || [],
    keywordMatches: [],
    matchedQueries: [],
    matchedConcepts: [],
    relevanceScore: 0,
    citationScore: 0,
    noveltyScore: paper.year ? Math.min(1, Math.max(0, (paper.year - 2015) / 10)) : 0.5,
    openAccessScore: paper.isOpenAccess ? 0.8 : 0.2,
    finalScore: 0,
  }
}

export interface S2SearchParams {
  query: string
  maxResults?: number
  year?: string
  fieldsOfStudy?: string[]
  publicationTypes?: string[]
  openAccessOnly?: boolean
  minCitationCount?: number
  sortBy?: 'relevance' | 'citationCount' | 'publicationDate'
  signal?: AbortSignal
}

export async function searchSemanticScholar(params: S2SearchParams): Promise<SearchPaper[]> {
  const { query, maxResults = 10, year, fieldsOfStudy, publicationTypes, openAccessOnly, minCitationCount, sortBy, signal } = params

  const queryParams: Record<string, string> = {
    query: query.trim(),
    limit: String(Math.min(maxResults, 100)),
    fields: PAPER_FIELDS,
  }

  if (year) queryParams.year = year
  if (fieldsOfStudy?.length) queryParams.fieldsOfStudy = fieldsOfStudy.join(',')
  if (publicationTypes?.length) queryParams.publicationTypes = publicationTypes.join(',')
  if (openAccessOnly) queryParams.openAccessPdf = ''
  if (minCitationCount) queryParams.minCitationCount = String(minCitationCount)
  if (sortBy) queryParams.sort = sortBy

  const result = await s2Fetch<S2SearchResponse>('/paper/search', queryParams, signal)
  return (result.data || []).map(normalizeS2Paper)
}

export async function getS2PaperById(paperId: string, signal?: AbortSignal): Promise<SearchPaper | null> {
  try {
    const paper = await s2Fetch<S2Paper>('/paper/' + encodeURIComponent(paperId), { fields: PAPER_FIELDS }, signal)
    return normalizeS2Paper(paper)
  } catch {
    return null
  }
}

export async function getS2References(paperId: string, limit = 10, signal?: AbortSignal): Promise<SearchPaper[]> {
  const result = await s2Fetch<{ data: S2Paper[] }>(
    '/paper/' + encodeURIComponent(paperId) + '/references',
    { fields: PAPER_FIELDS, limit: String(limit) },
    signal,
  )
  return (result.data || []).map(normalizeS2Paper).filter(p => p.title)
}

export async function getS2Citations(paperId: string, limit = 10, signal?: AbortSignal): Promise<SearchPaper[]> {
  const result = await s2Fetch<{ data: S2Paper[] }>(
    '/paper/' + encodeURIComponent(paperId) + '/citations',
    { fields: PAPER_FIELDS, limit: String(limit) },
    signal,
  )
  return (result.data || []).map(normalizeS2Paper).filter(p => p.title)
}
