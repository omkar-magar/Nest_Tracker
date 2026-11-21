-- Storage for the PG-management modules (Supabase only; on Render, R2 replaces Storage and migrate.js skips this file).
-- Every bucket except property-photos is private; files are opened with short-lived signed URLs.
--   customer-documents  <customer_id>/<file>   tenants' IDs, agreements, checklist photos, payment proofs
--   complaint-media     <uploader_id>/<file>   complaint photos / short videos, before and after
--   employee-documents  <staff_id>/<file>      staff IDs, contracts, bank proof, attendance selfies, task photos
--   expense-receipts    <property_id>/<file>   bills and receipts
--   property-photos     <property_id>/<file>   public listing photos

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('complaint-media', 'complaint-media', false, 20971520,
   array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime']),
  ('employee-documents', 'employee-documents', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('expense-receipts', 'expense-receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('property-photos', 'property-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- the office reads and uploads tenant documents for the tenants it manages
create policy "documents: office reads" on storage.objects for select to authenticated
  using (bucket_id = 'customer-documents' and public.can_see_user(((storage.foldername(name))[1])::uuid));
create policy "documents: office uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-documents' and public.can_see_user(((storage.foldername(name))[1])::uuid));

create policy "complaint media: upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'complaint-media' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "complaint media: read" on storage.objects for select to authenticated
  using (bucket_id = 'complaint-media' and ((storage.foldername(name))[1] = auth.uid()::text
         or public.current_app_role() in ('admin', 'manager', 'employee')));

create policy "employee docs: office" on storage.objects for all to authenticated
  using (bucket_id = 'employee-documents' and public.can_manage_property(public.staff_property(((storage.foldername(name))[1])::uuid)))
  with check (bucket_id = 'employee-documents' and public.can_manage_property(public.staff_property(((storage.foldername(name))[1])::uuid)));
create policy "employee docs: own selfies and task photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-documents' and (storage.foldername(name))[1] = public.my_staff_id()::text);
create policy "employee docs: read own" on storage.objects for select to authenticated
  using (bucket_id = 'employee-documents' and (storage.foldername(name))[1] = public.my_staff_id()::text);

create policy "receipts: office" on storage.objects for all to authenticated
  using (bucket_id = 'expense-receipts' and public.can_manage_property((storage.foldername(name))[1]))
  with check (bucket_id = 'expense-receipts' and public.can_manage_property((storage.foldername(name))[1]));

create policy "property photos: public read" on storage.objects for select using (bucket_id = 'property-photos');
create policy "property photos: office write" on storage.objects for all to authenticated
  using (bucket_id = 'property-photos' and public.can_manage_property((storage.foldername(name))[1]))
  with check (bucket_id = 'property-photos' and public.can_manage_property((storage.foldername(name))[1]));
