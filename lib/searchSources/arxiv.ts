/**
 * ArXiv API client
 * Docs: https://info.arxiv.org/help/api/
 * No API key required, rate limit ~3s between requests
 */

import type { SearchPaper, ConceptNode } from '../literatureSearchTypes'

const ARXIV_BASE = 'https://export.arxiv.org/api/query'

function parseArxivAtom(xml: string): any[] {
  const entries: any[] = []
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g
  let match: RegExpExecArray | null

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1]
    const getTag = (tag: string) => {
      const m = block.match(new RegExp('<' + tag + '[^>]*>([\\s\\S]*?)<\\/' + tag + '>'))
      return m ? m[1].trim() : ''
    }

    const id = getTag('id')
    const title = getTag('title').replace(/\s+/g, ' ').trim()
    const summary = getTag('summary').replace(/\s+/g, ' ').trim()
    const published = getTag('published')

    const nameRegex = /<name>([^<]+)<\/name>/g
    const authors: string[] = []
    let nm: RegExpExecArray | null
    while ((nm = nameRegex.exec(block)) !== null) authors.push(nm[1].trim())

    const catRegex = /category\s+term="([^"]+)"/g
    const categories: string[] = []
    let cm: RegExpExecArray | null
    while ((cm = catRegex.exec(block)) !== null) categories.push(cm[1])

    const doiMatch = block.match(/<arxiv:doi[^>]*>([\s\S]*?)<\/arxiv:doi>/)
    const doi = doiMatch ? doiMatch[1].trim() : ''
    const journalMatch = block.match(/<arxiv:journal_ref[^>]*>([\s\S]*?)<\/arxiv:journal_ref>/)
    const journalRef = journalMatch ? journalMatch[1].trim() : ''

    const pdfMatch = block.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/)
    const absMatch = block.match(/<link[^>]*href="([^"]+)"/)

    entries.push({
      id, title, summary, published, authors, categories, doi, journalRef,
      pdfUrl: pdfMatch ? pdfMatch[1] : id.replace('/abs/', '/pdf/'),
      url: absMatch ? absMatch[1] : id,
    })
  }
  return entries
}

function normalizeArxivEntry(entry: any): SearchPaper {
  const year = entry.published ? parseInt(entry.published.slice(0, 4)) : undefined
  const concepts: ConceptNode[] = entry.categories.map((cat: string) => ({
    id: 'arxiv:' + cat,
    displayName: cat,
    level: 0,
  }))

  return {
    id: entry.id,
    openAlexId: '',
    title: entry.title,
    abstract: entry.summary,
    abstractSnippet: entry.summary.length > 220 ? entry.summary.slice(0, 217) + '...' : entry.summary,
    authors: entry.authors,
    authorIds: [],
    year,
    publicationDate: entry.published?.slice(0, 10),
    venue: entry.journalRef || 'arXiv preprint',
    doi: entry.doi || undefined,
    url: entry.url,
    pdfUrl: entry.pdfUrl,
    citedByCount: 0,
    isOpenAccess: true,
    oaStatus: 'gold',
    sourceType: 'repository',
    concepts,
    topics: entry.categories,
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

export interface ArxivSearchParams {
  query: string
  maxResults?: number
  sortBy?: 'relevance' | 'lastUpdatedDate' | 'submittedDate'
  sortOrder?: 'ascending' | 'descending'
  categories?: string[]
  signal?: AbortSignal
}

export async function searchArxiv(params: ArxivSearchParams): Promise<SearchPaper[]> {
  const { query, maxResults = 10, sortBy = 'relevance', sortOrder = 'descending', categories = [], signal } = params

  let searchQuery = query.trim()
  if (categories.length > 0) {
    const catFilter = categories.map(c => 'cat:' + c).join(' OR ')
    searchQuery = '(' + searchQuery + ') AND (' + catFilter + ')'
  }

  const url = new URL(ARXIV_BASE)
  url.searchParams.set('search_query', 'all:' + searchQuery)
  url.searchParams.set('start', '0')
  url.searchParams.set('max_results', String(maxResults))
  url.searchParams.set('sortBy', sortBy)
  url.searchParams.set('sortOrder', sortOrder)

  const response = await fetch(url.toString(), { signal })
  if (!response.ok) throw new Error('ArXiv API error: ' + response.status)

  const xml = await response.text()
  return parseArxivAtom(xml).map(normalizeArxivEntry)
}

export async function getArxivPaperById(arxivId: string, signal?: AbortSignal): Promise<SearchPaper | null> {
  const url = ARXIV_BASE + '?id_list=' + encodeURIComponent(arxivId)
  const response = await fetch(url, { signal })
  if (!response.ok) return null
  const xml = await response.text()
  const entries = parseArxivAtom(xml)
  return entries.length > 0 ? normalizeArxivEntry(entries[0]) : null
}
