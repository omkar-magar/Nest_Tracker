-- Storage. customer-documents is private: files live under <customer_id>/<file> and only the owner
-- (or an admin) can read them. room-images is public-read, admin-write.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('customer-documents', 'customer-documents', false, 5242880,
   array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('room-images', 'room-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "documents: owner reads" on storage.objects for select to authenticated
  using (bucket_id = 'customer-documents'
         and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

create policy "documents: owner uploads" on storage.objects for insert to authenticated
  with check (bucket_id = 'customer-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "documents: owner deletes" on storage.objects for delete to authenticated
  using (bucket_id = 'customer-documents' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "room images: public read" on storage.objects for select
  using (bucket_id = 'room-images');

create policy "room images: admin write" on storage.objects for all to authenticated
  using (bucket_id = 'room-images' and public.is_admin())
  with check (bucket_id = 'room-images' and public.is_admin());
