import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import App from '../src/App'

test('App renders heading', () => {
  render(<App />)
  expect(screen.getByRole('heading', { name: /evalcull/i })).toBeInTheDocument()
})
