/**
 * Unified multi-source academic search
 * Aggregates results from OpenAlex, ArXiv, Semantic Scholar, PubMed, CrossRef, medRxiv
 */

import type { SearchPaper } from '../literatureSearchTypes'
import { searchArxiv } from './arxiv'
import { searchSemanticScholar } from './semanticScholar'
import { searchPubMed } from './pubmed'
import { searchCrossRef } from './crossref'
import { searchRxiv } from './medrxiv'

export type SearchSource = 'openalex' | 'arxiv' | 'semantic_scholar' | 'pubmed' | 'crossref' | 'medrxiv' | 'biorxiv'

export interface MultiSearchParams {
  query: string
  sources?: SearchSource[]
  maxResultsPerSource?: number
  fromYear?: number
  toYear?: number
  openAccessOnly?: boolean
  signal?: AbortSignal
}

export interface MultiSearchResult {
  source: SearchSource
  papers: SearchPaper[]
  error?: string
}

export interface MultiSearchResponse {
  results: MultiSearchResult[]
  allPapers: SearchPaper[]
  totalFound: number
  sourcesSearched: number
  sourcesFailed: number
}

export const ALL_SOURCES: SearchSource[] = ['openalex', 'arxiv', 'semantic_scholar', 'pubmed', 'crossref', 'medrxiv']

export const SOURCE_LABELS: Record<SearchSource, string> = {
  openalex: 'OpenAlex',
  arxiv: 'ArXiv',
  semantic_scholar: 'Semantic Scholar',
  pubmed: 'PubMed',
  crossref: 'CrossRef',
  medrxiv: 'medRxiv',
  biorxiv: 'bioRxiv',
}

export const SOURCE_DESCRIPTIONS: Record<SearchSource, string> = {
  openalex: '综合学术元数据库，覆盖各学科期刊、会议论文',
  arxiv: 'AI/CS/物理/数学/统计预印本',
  semantic_scholar: '引用关系、TLDR、开放PDF、相似论文推荐',
  pubmed: '生物医学、生命科学期刊文献',
  crossref: 'DOI元数据、期刊论文、出版信息',
  medrxiv: '医学预印本',
  biorxiv: '生物学预印本',
}

async function searchSingleSource(
  source: SearchSource,
  params: {
    query: string
    maxResults: number
    fromYear?: number
    toYear?: number
    openAccessOnly?: boolean
    signal?: AbortSignal
  },
): Promise<SearchPaper[]> {
  const { query, maxResults, fromYear, toYear, openAccessOnly, signal } = params

  switch (source) {
    case 'arxiv':
      return searchArxiv({ query, maxResults, signal })

    case 'semantic_scholar':
      return searchSemanticScholar({
        query,
        maxResults,
        year: fromYear || toYear ? (fromYear || '') + '-' + (toYear || '') : undefined,
        openAccessOnly,
        signal,
      })

    case 'pubmed':
      return searchPubMed({
        query,
        maxResults,
        minDate: fromYear ? fromYear + '/01/01' : undefined,
        maxDate: toYear ? toYear + '/12/31' : undefined,
        signal,
      })

    case 'crossref':
      return searchCrossRef({
        query,
        maxResults,
        fromYear,
        toYear,
        signal,
      })

    case 'medrxiv':
      return searchRxiv({
        query,
        maxResults,
        server: 'medrxiv',
        startDate: fromYear ? fromYear + '-01-01' : undefined,
        endDate: toYear ? toYear + '-12-31' : undefined,
        signal,
      })

    case 'biorxiv':
      return searchRxiv({
        query,
        maxResults,
        server: 'biorxiv',
        startDate: fromYear ? fromYear + '-01-01' : undefined,
        endDate: toYear ? toYear + '-12-31' : undefined,
        signal,
      })

    default:
      return []
  }
}

export async function searchMultipleSources(params: MultiSearchParams): Promise<MultiSearchResponse> {
  const {
    query,
    sources = ['arxiv', 'semantic_scholar', 'pubmed', 'crossref', 'medrxiv'],
    maxResultsPerSource = 8,
    fromYear,
    toYear,
    openAccessOnly,
    signal,
  } = params

  const searchParams = { query, maxResults: maxResultsPerSource, fromYear, toYear, openAccessOnly, signal }

  const settled = await Promise.allSettled(
    sources.map(source =>
      searchSingleSource(source, searchParams)
        .then(papers => ({ source, papers } as MultiSearchResult))
        .catch(err => ({ source, papers: [] as SearchPaper[], error: err instanceof Error ? err.message : String(err) } as MultiSearchResult))
    ),
  )

  const results: MultiSearchResult[] = settled.map(r => r.status === 'fulfilled' ? r.value : { source: 'openalex' as SearchSource, papers: [], error: 'Unknown error' })

  const allPapers = results.flatMap(r => r.papers)
  const totalFound = allPapers.length
  const sourcesSearched = results.filter(r => !r.error).length
  const sourcesFailed = results.filter(r => r.error).length

  return { results, allPapers, totalFound, sourcesSearched, sourcesFailed }
}

export function deduplicatePapers(papers: SearchPaper[]): SearchPaper[] {
  const seen = new Map<string, SearchPaper>()

  for (const paper of papers) {
    const doiKey = paper.doi ? paper.doi.toLowerCase() : undefined
    const titleKey = paper.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 80)

    const key = doiKey || titleKey || paper.id

    if (!seen.has(key)) {
      seen.set(key, paper)
    } else {
      const existing = seen.get(key)!
      if (paper.citedByCount > existing.citedByCount) {
        seen.set(key, paper)
      }
    }
  }

  return Array.from(seen.values())
}

export { searchArxiv } from './arxiv'
export { searchSemanticScholar, getS2PaperById, getS2References, getS2Citations } from './semanticScholar'
export { searchPubMed, getPubMedArticleById } from './pubmed'
export { searchCrossRef, getCrossRefWorkByDOI } from './crossref'
export { searchRxiv, getRxivPaperByDOI } from './medrxiv'
