import { createClient } from 'npm:@supabase/supabase-js@2'
import { demoRegistrationHandler } from '../_shared/demoRegistration.js'

// Deliberately public demo login, only when explicitly enabled on a test project.
Deno.serve(demoRegistrationHandler({
  enabled: Deno.env.get('DEMO_REGISTRATION_ENABLED') === 'true',
  createAdmin: () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!),
}))
