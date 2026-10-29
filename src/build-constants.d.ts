/**
 * Build-time constant injected by vite.config.ts (see
 * scripts/simulation-config.mjs). Exact hostnames on which a simulation
 * artifact may activate the fictional mock composition. Always [] outside a
 * simulation build.
 */
declare const __ELVIE_SIMULATION_HOSTS__: readonly string[];
