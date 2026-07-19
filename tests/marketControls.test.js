import { describe, expect, it } from 'vitest'

import { mountAppShell } from '../src/views/appShell.js'
import { renderMarketControls } from '../src/views/marketControls.js'

function mountedControls() {
  const root = document.createElement('div')
  const refs = mountAppShell(root)
  return { root, refs }
}

describe('Recent market report download', () => {
  it('mounts a descriptive GET anchor beside Refresh', () => {
    const { refs } = mountedControls()

    expect(refs.downloadButton.tagName).toBe('A')
    expect(refs.downloadButton.textContent).toBe('Download JSON')
    expect(refs.downloadButton.parentElement).toBe(refs.refreshButton.parentElement)
    expect(refs.downloadButton.getAttribute('aria-label')).toContain(
      'finished-market schema-v2 JSON report',
    )
    expect(refs.downloadButton.title).toContain('7-day retention')
  })

  it('stays hidden and non-navigable outside Recent mode', () => {
    const { refs } = mountedControls()

    renderMarketControls(refs, {
      mode: 'live',
      completed: true,
      downloadUrl: '/api/markets/42/shadow-evaluations/download',
    })

    expect(refs.downloadButton.hidden).toBe(true)
    expect(refs.downloadButton.hasAttribute('href')).toBe(false)
    expect(refs.downloadButton.getAttribute('aria-disabled')).toBe('true')
  })

  it.each([
    ['unfinished market', false, '/api/markets/42/shadow-evaluations/download'],
    ['missing URL', true, null],
    ['blank URL', true, '   '],
  ])('is disabled in Recent mode for %s', (_label, completed, downloadUrl) => {
    const { refs } = mountedControls()

    renderMarketControls(refs, { mode: 'recent', completed, downloadUrl })

    expect(refs.downloadButton.hidden).toBe(false)
    expect(refs.downloadButton.hasAttribute('href')).toBe(false)
    expect(refs.downloadButton.getAttribute('aria-disabled')).toBe('true')
  })

  it('enables only a completed Recent market and clears stale links on transition', () => {
    const { refs } = mountedControls()
    const downloadUrl = '/api/markets/42/shadow-evaluations/download'

    renderMarketControls(refs, { mode: 'recent', completed: true, downloadUrl })
    expect(refs.downloadButton.hidden).toBe(false)
    expect(refs.downloadButton.getAttribute('href')).toBe(downloadUrl)
    expect(refs.downloadButton.hasAttribute('aria-disabled')).toBe(false)

    renderMarketControls(refs, { mode: 'recent', completed: false, downloadUrl })
    expect(refs.downloadButton.hasAttribute('href')).toBe(false)
    expect(refs.downloadButton.getAttribute('aria-disabled')).toBe('true')
  })
})
