Registration testing
====================

Apply `20261125000001_registration_approval.sql` to the test database. Deploy the
`demo-registration` Edge Function (its JWT setting is in `supabase/config.toml`).
Set the server secret `DEMO_REGISTRATION_ENABLED=true` in that test project and
`VITE_DEMO_REGISTRATION=true` in the frontend environment, then rebuild the frontend.
The Vercel build command currently enables this frontend flag for the requested
live testing. Remove that prefix from `vercel.json` when testing is finished.
The demo login deliberately accepts any non-empty code and gives access only to
`customer@yolonest.test`, which must be an active customer. Use a test project;
disable both flags after testing. No service-role key goes in frontend variables.

1. Open `/signup` signed out and click **Fill demo registration**. Choose the wing,
   review the sample details, click **Create account**, enter any key in **Demo OTP**,
   and click **Verify demo OTP and register**.
2. The customer sees **Waiting for manager’s approval**. In another browser/profile,
   sign in as that wing’s manager and open **Guest register → New registrations**.
3. Click **Review and approve**, review the resident’s information, enter room, rent,
   deposit, check-in and rent due date, then approve. The guest appears in **Current
   guests**. Refresh the customer tab (or wait up to 15 seconds) to see approval and
   stay details. These register amounts are stay details, not generated invoices.
4. Check out the guest, or remove the entry using the register’s existing controls.
   The customer sees the thank-you message, manager-help guidance and stay history.
   Deleted entries remain in customer history through the register audit log.
5. Sign out the customer and repeat from `/signup`. The demo uses the same existing
   Supabase login; checkout/removal does not delete the authentication account.
   Previous stays remain visible. An active stay prevents re-registration.

Regular registrations keep Supabase email confirmation. When confirmation is
required, the form stays in this browser; after login, review and save it under
**Emergency contacts and other details**, choosing the property to submit for approval.
