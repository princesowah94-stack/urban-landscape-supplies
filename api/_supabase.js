import { createClient } from '@supabase/supabase-js';

// Lazy init — creating the client at module load crashes every endpoint that
// imports this file when env vars are missing (FUNCTION_INVOCATION_FAILED).
// Deferring to first use lets endpoints degrade gracefully (e.g. trade
// applications still send the staff email when Supabase isn't configured).
let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    }
    _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _client;
}

export const supabase = new Proxy({}, {
  get(_target, prop) {
    const client = getClient();
    const value = client[prop];
    return typeof value === 'function' ? value.bind(client) : value;
  },
});
