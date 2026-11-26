-- Enquiries are split into "not approached" (still new, nothing sent) and "approached" (called, messaged or sent a
-- coupon). approached_at records when the enquiry first left "new"; coupons set it too.
create function public.enquiry_approached() returns trigger
language plpgsql as $$
begin
  if old.status = 'new' and new.status <> 'new' and new.approached_at is null then new.approached_at := now(); end if;
  return new;
end $$;
create trigger enquiries_approached before update of status on public.enquiries
  for each row execute function public.enquiry_approached();
