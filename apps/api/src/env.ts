/**
 * Worker bindings + config. Vars live in wrangler.toml [vars]; secrets
 * (none yet) would be set via `wrangler secret put`
 * (scripts/setup-secrets.ps1).
 */
export type Bindings = {
    DB: D1Database;
    ENVIRONMENT: string;
};
