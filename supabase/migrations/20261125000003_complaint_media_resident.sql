-- Residents can open every image on their own complaints, including resolution photos the manager uploaded
-- into the manager's own folder. (Office roles already read the whole complaint-media bucket.)
create policy "complaint media: resident reads own complaint files" on storage.objects for select to authenticated
  using (bucket_id = 'complaint-media' and exists (
    select 1 from public.complaints c where c.customer_id = auth.uid() and name = any (c.photos || c.after_photos)));
