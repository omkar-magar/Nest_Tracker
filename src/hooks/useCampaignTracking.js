import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'

// Tracked links and QR codes (PRD 9.2): a visit to any page with ?c=<campaign code> (or utm_campaign) is remembered
// for this browser session, so an enquiry sent later is credited to that campaign.
export const CAMPAIGN_KEY = 'yolo.campaign'

export function campaignCode() {
  try { return sessionStorage.getItem(CAMPAIGN_KEY) || '' } catch { return '' }
}

export default function useCampaignTracking() {
  const { search } = useLocation()
  useEffect(() => {
    const p = new URLSearchParams(search)
    const code = p.get('c') || p.get('utm_campaign')
    if (code && /^[\w-]{2,32}$/.test(code)) {
      try { sessionStorage.setItem(CAMPAIGN_KEY, code) } catch { /* private mode: not tracked */ }
    }
  }, [search])
}
