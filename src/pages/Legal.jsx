import { PageHeader, Notice } from '../components/ui'
import { brand } from '../data/site'

function Page({ title, children }) {
  return (
    <>
      <PageHeader title={title} />
      <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-10 text-slate-700">
        <Notice tone="warn">Draft text for the demo. The owner should review it, and a lawyer should approve it, before launch.</Notice>
        {children}
      </div>
    </>
  )
}
const H = ({ children }) => <h2 className="pt-2 text-lg font-semibold text-navy">{children}</h2>

export function Privacy() {
  return (
    <Page title="Privacy policy">
      <H>What we collect</H>
      <p>Your name, mobile number and email when you create an account. Identity or address documents you choose to upload for your stay. Your bookings, bills and payment records.</p>
      <H>How we use it</H>
      <p>To run your booking, contact you about your stay and payments, and keep the PG safe. We do not sell your data.</p>
      <H>Who can see it</H>
      <p>You can see your own information. PG staff see what they need to run the PG, and the owner sees everything. Uploaded documents are private to you and the owner.</p>
      <H>Payments</H>
      <p>Card and bank details are handled by the payment provider and are not stored by us.</p>
      <H>Your choices</H>
      <p>You can edit your details and delete your uploaded documents from your dashboard. For anything else, call {brand.phone}.</p>
    </Page>
  )
}

export function Terms() {
  return (
    <Page title="Terms and conditions">
      <H>Bookings</H>
      <p>Beds are held for 30 minutes after you reserve them. If the first bills are not paid in that time, the hold is released.</p>
      <H>Payments</H>
      <p>Rent and deposits are due on the dates shown on each bill. Overdue bills are visible to PG staff, who may contact you.</p>
      <H>House rules</H>
      <p>Residents agree to follow the PG rules shared at check-in and to respect shared spaces and housemates.</p>
      <H>Cancellation and refunds</H>
      <p>You can cancel an unpaid hold any time. For paid stays and deposits, contact the PG office on {brand.phone}.</p>
      <H>Changes</H>
      <p>We may update these terms. The version on this page applies.</p>
    </Page>
  )
}
