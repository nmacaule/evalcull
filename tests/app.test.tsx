import { render, screen, waitFor, act } from '@testing-library/react'
import { expect, test } from 'vitest'
import 'fake-indexeddb/auto'
import App from '../src/App'
import { makeSource, loadSource, card, resetStore, FLAT_IO } from './helpers/app'

test('App renders heading', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: /evalcull/i })).toBeInTheDocument()
})

test('a flat file opened after App mounts on the empty page renders its response, not the raw line (D-091)', async () => {
  resetStore()
  // App mounts first, as in the browser: no file is open, so the store's format is unknown
  const { container } = render(<App />)
  expect(screen.getByRole('button', { name: 'Open file' })).toBeInTheDocument()
  const source = makeSource(['{"instruction":"p0","output":"red"}', '{"instruction":"p1","output":"blue"}'], [0, 1], [1, 1])
  await act(() => loadSource(source, FLAT_IO))
  await waitFor(() => expect(card(container, '0').textContent).toContain('red'))
  const content = card(container, '0').querySelector('[data-card-content]')!
  expect(content.querySelector('pre')).toBeNull()
  expect(content.textContent).toBe('red')
})
