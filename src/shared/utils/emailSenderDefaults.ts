/**
 * Email sender defaults.
 *
 * Leaf module with no imports on purpose: the settings model imports this, and
 * pulling `config/env` into the model would drag the whole env bootstrap (which
 * throws on missing vars) into every consumer of the model.
 *
 * Keep `DEFAULT_FROM_EMAIL` in step with the `COMPANY_EMAIL` env var. The
 * address is a placeholder only until the align migration / env wiring runs —
 * the real sender is always `COMPANY_EMAIL`.
 */
export const DEFAULT_FROM_EMAIL = 'apply@ats.aristagroups.com';
export const DEFAULT_FROM_NAME = 'Arista ATS';
