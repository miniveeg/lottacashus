/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SOL_ADDRESS?: string;
  readonly VITE_LTC_ADDRESS?: string;
  readonly VITE_ETH_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
