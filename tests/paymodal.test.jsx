import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ payBill: vi.fn(), provider: { isSimulated: true } }))
vi.mock('../src/services/payments', () => ({ payBill: h.payBill, paymentProvider: h.provider }))

import PayModal from '../src/components/PayModal'

const bill = { id: 'bill-1', amount: 7500, description: 'Rent November' }
let onClose, onFinished
const open = () => render(<PayModal bill={bill} onClose={onClose} onFinished={onFinished} />)

beforeEach(() => {
  h.payBill.mockReset()
  h.provider.isSimulated = true
  onClose = vi.fn()
  onFinished = vi.fn()
})

describe('PayModal (demo provider)', () => {
  it('is an accessible dialog showing the amount and description', () => {
    open()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: 'Pay ₹7,500' })).toBeInTheDocument()
    expect(screen.getByText('Rent November')).toBeInTheDocument()
    expect(dialog).toHaveFocus()
  })
  it('warns that no real money moves', () => {
    open()
    expect(screen.getByText(/No real money moves/)).toBeInTheDocument()
  })
  it('simulating success sends the "success" outcome and reports what the database says', async () => {
    h.payBill.mockImplementation(async (b, ui) => {
      expect(await ui.chooseOutcome()).toBe('success')
      return { status: 'succeeded', is_simulated: true }
    })
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }))
    expect(await screen.findByText(/Payment recorded \(simulated\)\. Your bill is now paid\./)).toBeInTheDocument()
    expect(h.payBill).toHaveBeenCalledWith(bill, expect.any(Object))
    expect(onFinished).toHaveBeenCalled()
  })
  it('simulating failure sends the "failure" outcome and shows the reason', async () => {
    h.payBill.mockImplementation(async (b, ui) => {
      expect(await ui.chooseOutcome()).toBe('failure')
      return { status: 'failed', failure_reason: 'Card declined' }
    })
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Simulate failed payment' }))
    expect(await screen.findByText(/Payment failed: Card declined\. Your bill is still unpaid\./)).toBeInTheDocument()
  })
  it('does not trust a "success" click when the database row says failed', async () => {
    h.payBill.mockResolvedValue({ status: 'failed', failure_reason: null })
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }))
    expect(await screen.findByText(/Payment failed\. Your bill is still unpaid\./)).toBeInTheDocument()
    expect(screen.queryByText(/now paid/)).not.toBeInTheDocument()
  })
  it('a payment still "created" says nothing was received yet', async () => {
    h.payBill.mockResolvedValue({ status: 'created' })
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }))
    expect(await screen.findByText(/No payment received yet/)).toBeInTheDocument()
  })
  it('shows backend errors in an alert and lets the customer retry', async () => {
    h.payBill.mockRejectedValue(new Error('Bill already paid'))
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Bill already paid')
    expect(screen.getByRole('button', { name: 'Simulate successful payment' })).toBeEnabled()
    expect(onFinished).not.toHaveBeenCalled()
  })
  it('disables the buttons while a payment is processing', async () => {
    let finish
    h.payBill.mockReturnValue(new Promise((r) => { finish = r }))
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }))
    expect(screen.getByRole('button', { name: 'Processing…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    finish({ status: 'succeeded' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument())
  })
  it('Cancel and Escape close the dialog', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })
  it('Escape does nothing while processing', async () => {
    h.payBill.mockReturnValue(new Promise(() => {}))
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).not.toHaveBeenCalled()
  })
  it('Close after a result calls onClose', async () => {
    h.payBill.mockResolvedValue({ status: 'succeeded' })
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Simulate successful payment' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('PayModal (real gateway)', () => {
  beforeEach(() => { h.provider.isSimulated = false })

  it('shows a single Pay button and no demo wording', () => {
    open()
    expect(screen.getByRole('button', { name: 'Pay ₹7,500' })).toBeInTheDocument()
    expect(screen.queryByText(/Demo payment/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Simulate/ })).not.toBeInTheDocument()
  })
  it('starts checkout without picking an outcome', async () => {
    h.payBill.mockResolvedValue({ status: 'succeeded', is_simulated: false })
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Pay ₹7,500' }))
    expect(await screen.findByText('Payment recorded. Your bill is now paid.')).toBeInTheDocument()
  })
})
