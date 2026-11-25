// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { demoRegistrationHandler } from '../supabase/functions/_shared/demoRegistration'

const request = (body) => new Request('https://example.test/demo-registration', { method: 'POST', body: JSON.stringify(body) })
const setup = (profile = { role: 'customer', is_active: true }) => {
  const generateLink = vi.fn(async () => ({ data: { user: { id: 'demo' }, properties: { hashed_token: 'hash' } } }))
  const single = vi.fn(async () => ({ data: profile }))
  const chain = { select: () => chain, eq: () => chain, single }
  const createAdmin = vi.fn(() => ({ auth: { admin: { generateLink } }, from: () => chain }))
  return { createAdmin, generateLink }
}

describe('demo authentication boundary', () => {
  it('is disabled without the explicit server flag', async () => {
    const { createAdmin } = setup()
    const res = await demoRegistrationHandler({ enabled: false, createAdmin })(request({ code: 'x' }))
    expect(res.status).toBe(403)
    expect(createAdmin).not.toHaveBeenCalled()
  })
  it('ignores caller-supplied emails and only issues the fixed demo customer token', async () => {
    const { createAdmin, generateLink } = setup()
    const res = await demoRegistrationHandler({ enabled: true, createAdmin })(request({ code: 'x', email: 'owner@example.com' }))
    expect(await res.json()).toEqual({ token_hash: 'hash' })
    expect(generateLink).toHaveBeenCalledWith({ type: 'magiclink', email: 'customer@yolonest.test' })
  })
  it.each([{ role: 'admin', is_active: true }, { role: 'manager', is_active: true }, { role: 'customer', is_active: false }])('rejects a privileged or disabled demo profile: %j', async (profile) => {
    const { createAdmin } = setup(profile)
    const res = await demoRegistrationHandler({ enabled: true, createAdmin })(request({ code: 'x' }))
    expect(res.status).toBe(403)
    expect(await res.json()).not.toHaveProperty('token_hash')
  })
  it.each(['', ' ', null, 123])('requires a nonempty demo code: %j', async (code) => {
    const { createAdmin } = setup()
    const res = await demoRegistrationHandler({ enabled: true, createAdmin })(request({ code }))
    expect(res.status).toBe(400)
    expect(createAdmin).not.toHaveBeenCalled()
  })
})
