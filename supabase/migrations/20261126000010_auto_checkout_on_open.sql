-- pg_cron is not enabled on the hosted project, so the scheduled jobs do not run there. Daily stays still leave on
-- time: the resident's page and the guest register run the automatic check-out when they open. It only checks out
-- daily stays whose check-out date has come, so any signed-in user may trigger it.
grant execute on function public.register_auto_checkout() to authenticated;
