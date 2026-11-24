import { vi } from 'vitest'
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import Navbar from '../src/components/Navbar'

describe('Navbar enquire button', () => {
  it('opens and closes the call back form', async () => {
    render(<MemoryRouter><Navbar /></MemoryRouter>)
    await userEvent.click(screen.getByRole('button', { name: 'Enquire Now' }))
    expect(screen.getByRole('dialog', { name: 'Request a call back' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
