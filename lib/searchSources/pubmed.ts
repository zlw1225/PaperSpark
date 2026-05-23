/**
 * PubMed / NCBI E-utilities API client
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25500/
 * No API key required for basic use (3 req/sec)
 */

import type { SearchPaper, ConceptNode } from '../literatureSearchTypes'

const PUBMED_BASE = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
const NCBI_API_KEY = process.env.NCBI_API_KEY || ''

function ncbiParams(extra: Record<string, string> = {}): URLSearchParams {
  return new URLSearchParams({
    db: 'pubmed',
    retmode: 'json',
    ...(NCBI_API_KEY ? { api_key: NCBI_API_KEY } : {}),
    ...extra,
  })
}

async function ncbiFetch<T>(endpoint: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const url = new URL(PUBMED_BASE + '/' + endpoint)
  const searchParams = ncbiParams(params)
  searchParams.forEach((value, key) => url.searchParams.set(key, value))
  const response = await fetch(url.toString(), { signal })
  if (!response.ok) throw new Error('PubMed API error: ' + response.status)
  return response.json() as Promise<T>
}

interface PubMedSearchResult {
  esearchresult: { idlist: string[]; count: string; retmax: string }
}

interface PubMedSummaryResult {
  result: { uids: string[]; [pmid: string]: any }
}

function normalizePubMedArticle(article: any): SearchPaper {
  const year = article.pubdate ? parseInt(article.pubdate.slice(0, 4)) : undefined
  const authors: string[] = article.authors?.map((a: any) => a.name) || []
  const doi = article.doi || article.elocationid?.replace('doi: ', '') || ''

  const concepts: ConceptNode[] = (article.pubtype || []).slice(0, 3).map((pt: string) => ({
    id: 'pubmed:type:' + pt,
    displayName: pt,
    level: 0,
  }))

  return {
    id: 'pmid:' + article.uid,
    openAlexId: '',
    title: article.title || '',
    abstract: article.abstract || '',
    abstractSnippet: article.abstract ? article.abstract.slice(0, 220) : '',
    authors,
    authorIds: [],
    year,
    publicationDate: article.sortpubdate || article.pubdate,
    venue: article.fulljournalname || '',
    doi: doi || undefined,
    url: 'https://pubmed.ncbi.nlm.nih.gov/' + article.uid + '/',
    pdfUrl: doi ? 'https://doi.org/' + doi : undefined,
    citedByCount: 0,
    isOpenAccess: false,
    oaStatus: 'closed',
    sourceType: 'journal',
    concepts,
    topics: article.pubtype || [],
    keywordMatches: [],
    matchedQueries: [],
    matchedConcepts: [],
    relevanceScore: 0,
    citationScore: 0,
    noveltyScore: year ? Math.min(1, Math.max(0, (year - 2015) / 10)) : 0.5,
    openAccessScore: 0.3,
    finalScore: 0,
  }
}

export interface PubMedSearchParams {
  query: string
  maxResults?: number
  minDate?: string
  maxDate?: string
  sortBy?: 'relevance' | 'date'
  signal?: AbortSignal
}

export async function searchPubMed(params: PubMedSearchParams): Promise<SearchPaper[]> {
  const { query, maxResults = 10, minDate, maxDate, sortBy = 'relevance', signal } = params

  const searchParams: Record<string, string> = {
    term: query.trim(),
    retmax: String(Math.min(maxResults, 100)),
    sort: sortBy === 'date' ? 'pub_date' : 'relevance',
  }

  if (minDate || maxDate) {
    searchParams.datetype = 'pdat'
    if (minDate) searchParams.mindate = minDate
    if (maxDate) searchParams.maxdate = maxDate
  }

  const searchResult = await ncbiFetch<PubMedSearchResult>('esearch.fcgi', searchParams, signal)
  const ids = searchResult.esearchresult?.idlist || []
  if (ids.length === 0) return []

  const summaryResult = await ncbiFetch<PubMedSummaryResult>('esummary.fcgi', { id: ids.join(',') }, signal)

  const articles: any[] = []
  for (const uid of summaryResult.result?.uids || []) {
    const article = summaryResult.result[uid]
    if (article && typeof article === 'object') articles.push(article)
  }

  return articles.map(normalizePubMedArticle)
}

export async function getPubMedArticleById(pmid: string, signal?: AbortSignal): Promise<SearchPaper | null> {
  try {
    const summaryResult = await ncbiFetch<PubMedSummaryResult>('esummary.fcgi', { id: pmid }, signal)
    const article = summaryResult.result[pmid]
    if (!article || typeof article !== 'object') return null
    return normalizePubMedArticle(article)
  } catch {
    return null
  }
}
