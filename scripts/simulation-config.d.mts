export type BuildMode = 'production' | 'simulation';
export type BuildEnv = Readonly<Record<string, string | undefined>>;

export declare const BUILD_MODES: readonly BuildMode[];
export declare const LOCAL_SIMULATION_HOSTS: readonly string[];

export declare class SimulationConfigError extends Error {
  constructor(message: string);
}

export declare function resolveBuildMode(env: BuildEnv): BuildMode;
export declare function assertSafeBuildEnvironment(env: BuildEnv, mode: string): void;
export declare function resolveSimulationHosts(env: BuildEnv): string[];
export declare function elvieBuildDefines(
  options: { command: 'build' | 'serve'; mode: string },
  env: BuildEnv,
): { __ELVIE_SIMULATION_HOSTS__: string };
