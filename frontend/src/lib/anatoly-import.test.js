import { describe, it, expect, vi } from 'vitest'
import {
  parseImportResponse, extractJsonBlock, readCandidate, buildRequest, buildImportPrompt,
  importFromImages, AnatolyImportError, ANATOLY_MODEL, MAX_OUTPUT_TOKENS,
} from './anatoly-import.js'
import { CLEAN, FENCED, TRUNCATED, TRUNCATED_INNER, UNREADABLE, NO_EXERCISES, MESSY, envelope } from './anatoly-import.fixtures.js'

const codeOf = fn => { try { fn(); return null } catch (e) { expect(e).toBeInstanceOf(AnatolyImportError); return e.code } }
const codeOfAsync = async p => { try { await p; return null } catch (e) { expect(e).toBeInstanceOf(AnatolyImportError); return e.code } }

describe('parseImportResponse', () => {
  it('reads a clean session into rows, in order', () => {
    const rows = parseImportResponse(CLEAN)
    expect(rows.map(r => r.sourceText)).toEqual(['Barbell back squat', 'Romanian deadlift', 'Standing low cable row', 'Plank', 'Dead hang'])
    expect(rows[0]).toEqual({ sourceText: 'Barbell back squat', sets: 4, reps: 6, repsMax: 8, targetWeight: 100, weightUnit: 'kg', timeSeconds: null, notes: 'Rest 3 min' })
  })

  it('keeps an unweighted row unweighted rather than inventing a weight', () => {
    expect(parseImportResponse(CLEAN)[2]).toMatchObject({ targetWeight: null, weightUnit: null, reps: 12 })
  })

  it('reads a timed hold as a duration with no reps', () => {
    expect(parseImportResponse(CLEAN)[3]).toMatchObject({ reps: null, timeSeconds: 45, sets: 3 })
  })

  it('keeps "Time: Max" in notes with no fabricated reps or duration (fit-app FIT-116)', () => {
    expect(parseImportResponse(CLEAN)[4]).toMatchObject({ sets: 1, reps: null, timeSeconds: null, notes: 'Time: Max' })
  })

  it('strips a markdown fence', () => {
    expect(parseImportResponse(FENCED)).toEqual([{ sourceText: 'Bench press', sets: 5, reps: 5, repsMax: null, targetWeight: 70, weightUnit: 'kg', timeSeconds: null, notes: null }])
  })

  it('reports a truncated answer as truncation, not as a parser failure (fit-app FIT-091)', () => {
    expect(codeOf(() => parseImportResponse(TRUNCATED))).toBe('truncated')
  })

  it('reports a cut-off answer as truncated even after inner objects closed', () => {
    expect(codeOf(() => parseImportResponse(TRUNCATED_INNER))).toBe('truncated')
  })

  it('is not fooled by braces inside strings', () => {
    const tricky = JSON.stringify({ imageReadable: true, exercises: [{ sourceText: 'Squat {paused}', notes: 'tempo "3}1" then }{', sets: 3 }] })
    expect(parseImportResponse(tricky)[0]).toMatchObject({ sourceText: 'Squat {paused}', notes: 'tempo "3}1" then }{', sets: 3 })
    expect(codeOf(() => parseImportResponse('{"exercises": [{"sourceText": "Squat {paused'))).toBe('truncated')
  })

  it('reports balanced but malformed JSON as unparseable', () => {
    expect(codeOf(() => parseImportResponse('{"exercises": [ {sourceText: "Squat"} ]}'))).toBe('unparseable')
  })

  it('tells unreadable images apart from readable images with no workout', () => {
    expect(codeOf(() => parseImportResponse(UNREADABLE))).toBe('unreadable')
    expect(codeOf(() => parseImportResponse(NO_EXERCISES))).toBe('empty')
  })

  it('names the other whole-answer failures', () => {
    expect(codeOf(() => parseImportResponse('Sorry, I cannot help with that.'))).toBe('no-json')
    expect(codeOf(() => parseImportResponse('{"imageReadable": true}'))).toBe('structure')
    expect(codeOf(() => parseImportResponse(''))).toBe('no-json')
    expect(codeOf(() => parseImportResponse(null))).toBe('no-json')
  })

  describe('a model that drifts from the schema', () => {
    const rows = parseImportResponse(MESSY)

    it('accepts numbers as strings, a decimal comma, and lbs', () => {
      expect(rows[0]).toMatchObject({ sourceText: 'Incline DB press', sets: 3, reps: 10, targetWeight: 22.5, weightUnit: 'lb' })
    })

    it('falls back to exerciseName for the name and leaves missing sets null, not 3 (fit-app FIT-125)', () => {
      expect(rows[1]).toMatchObject({ sourceText: 'Lat pulldown', sets: null, reps: 12 })
    })

    it('drops a range whose top is not above its bottom, and a weight that is not a number', () => {
      expect(rows[2]).toMatchObject({ sourceText: 'Lunges', reps: 10, repsMax: null, targetWeight: null })
    })

    it('treats zero or negative counts and weights, and unknown units, as not shown', () => {
      expect(rows[3]).toMatchObject({ sourceText: 'Face pull', sets: null, reps: null, targetWeight: null, weightUnit: null })
    })

    it('skips a row with no name at all', () => {
      expect(rows.map(r => r.sourceText)).toEqual(['Incline DB press', 'Lat pulldown', 'Lunges', 'Face pull', 'Farmer carry'])
    })

    it('ignores a duration on a row that has reps', () => {
      expect(rows[4]).toMatchObject({ reps: 20, timeSeconds: null, targetWeight: 32 })
    })
  })

  it('throws empty when every row lacked a name', () => {
    expect(codeOf(() => parseImportResponse(JSON.stringify({ imageReadable: true, exercises: [{ sets: 3 }] })))).toBe('empty')
  })
})

describe('extractJsonBlock', () => {
  it('returns the first complete top-level object, ignoring text around it', () => {
    expect(extractJsonBlock('Here you go:\n{"a": {"b": 1}}\nThanks {not this}')).toBe('{"a": {"b": 1}}')
  })
})

describe('readCandidate', () => {
  it('joins the answer parts and skips thinking parts', () => {
    expect(readCandidate(envelope('{"x":1}'))).toBe('{"x":1}')
  })

  it('reports the token budget running out before the text', () => {
    expect(codeOf(() => readCandidate(envelope('', 'MAX_TOKENS')))).toBe('max-tokens')
  })

  it('reports a blocked prompt, an early stop, and an empty answer', () => {
    expect(codeOf(() => readCandidate({ promptFeedback: { blockReason: 'SAFETY' } }))).toBe('blocked')
    expect(codeOf(() => readCandidate(envelope('x', 'SAFETY')))).toBe('stopped')
    expect(codeOf(() => readCandidate({ candidates: [] }))).toBe('no-text')
    expect(codeOf(() => readCandidate({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking', thought: true }] } }] }))).toBe('no-text')
  })
})

describe('buildRequest', () => {
  const body = buildRequest([{ base64: 'AAAA', mimeType: 'image/png' }, { base64: 'BBBB', mimeType: 'image/jpeg' }])

  it('sends the prompt then every image inline, in order', () => {
    const parts = body.contents[0].parts
    expect(parts[0].text).toBe(buildImportPrompt())
    expect(parts.slice(1)).toEqual([{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { inlineData: { mimeType: 'image/jpeg', data: 'BBBB' } }])
  })

  it('pins the budget at 8192 and asks for JSON', () => {
    expect(MAX_OUTPUT_TOKENS).toBe(8192)
    expect(body.generationConfig).toMatchObject({ maxOutputTokens: 8192, responseMimeType: 'application/json' })
  })

  it('does not put a library in the prompt; matching happens on the phone (OG-012)', () => {
    expect(buildImportPrompt()).not.toMatch(/LIBRARY|exerciseId/)
  })
})

describe('importFromImages', () => {
  const images = [{ base64: 'AAAA', mimeType: 'image/png' }]
  const ok = body => vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))

  it('calls the pinned model with the key in a header, never in the URL', async () => {
    const fetch = ok(envelope(CLEAN))
    const rows = await importFromImages(' AIzaTest ', images, { fetch })
    expect(rows).toHaveLength(5)
    const [url, init] = fetch.mock.calls[0]
    expect(ANATOLY_MODEL).toBe('gemini-3.5-flash')
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent')
    expect(url).not.toMatch(/key=|AIza/)
    expect(init.headers['x-goog-api-key']).toBe('AIzaTest')
    expect(JSON.parse(init.body).contents[0].parts[1].inlineData.data).toBe('AAAA')
  })

  it('refuses to call without a key or without images', async () => {
    const fetch = ok(envelope(CLEAN))
    expect(await codeOfAsync(importFromImages('', images, { fetch }))).toBe('no-key')
    expect(await codeOfAsync(importFromImages('k', [], { fetch }))).toBe('no-images')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('names a refused key, another HTTP error, and no network', async () => {
    const refused = vi.fn(async () => ({ ok: false, status: 400, json: async () => ({ error: { message: 'API key not valid. Please pass a valid API key.' } }) }))
    expect(await codeOfAsync(importFromImages('k', images, { fetch: refused }))).toBe('auth')
    const busy = vi.fn(async () => ({ ok: false, status: 503, json: async () => { throw new Error('html') } }))
    const e = await importFromImages('k', images, { fetch: busy }).catch(x => x)
    expect([e.code, e.status]).toEqual(['http', 503])
    const offline = vi.fn(async () => { throw new TypeError('Failed to fetch') })
    expect(await codeOfAsync(importFromImages('k', images, { fetch: offline }))).toBe('network')
  })

  it('passes a truncated answer through as truncated', async () => {
    expect(await codeOfAsync(importFromImages('k', images, { fetch: ok(envelope(TRUNCATED)) }))).toBe('truncated')
    expect(await codeOfAsync(importFromImages('k', images, { fetch: ok(envelope('', 'MAX_TOKENS')) }))).toBe('max-tokens')
  })

  it('lets a cancel through as a cancel', async () => {
    const abort = vi.fn(async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e })
    await expect(importFromImages('k', images, { fetch: abort })).rejects.toMatchObject({ name: 'AbortError' })
  })
})
