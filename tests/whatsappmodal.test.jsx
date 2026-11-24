import { vi } from 'vitest'
vi.mock('../src/context/AuthContext', () => import('./helpers/authMock.js'))
vi.mock('../src/lib/supabase', () => import('./helpers/supabaseMock.js'))
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WhatsAppLeadModal from '../src/components/WhatsAppLeadModal'
import { askBeforeWhatsApp, whatsappUrl } from '../src/services/contact'

describe('WhatsApp lead popup', () => {
  it('asks for details, then opens WhatsApp with them', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    render(<><a href={whatsappUrl()} onClick={askBeforeWhatsApp}>Chat</a><WhatsAppLeadModal /></>)
    expect(screen.queryByRole('dialog')).toBeNull()
    await userEvent.click(screen.getByText('Chat'))
    expect(open).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Name *'), 'Asha')
    await userEvent.type(screen.getByLabelText('WhatsApp number *'), '9876543210')
    await userEvent.click(screen.getByLabelText('₹20K-₹25K'))
    await userEvent.click(screen.getByRole('button', { name: 'Continue to WhatsApp' }))
    const url = decodeURIComponent(open.mock.calls[0][0])
    expect(url).toContain('Name: Asha')
    expect(url).toContain('Budget: ₹20K-₹25K')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
