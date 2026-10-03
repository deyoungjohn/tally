"use client";

import { Component, createContext, useContext, type ReactNode } from "react";
import type { ModuleName } from "@tally/config";
import type { ModuleHealthState } from "@tally/modkit";

const ModuleHealthContext = createContext<ModuleHealthState | null>(null);
export function useModuleHealth(): ModuleHealthState | null {
  return useContext(ModuleHealthContext);
}

function UpdateNotice({ module, health }: { module: ModuleName; health: ModuleHealthState }) {
  const minutes = Math.floor((health.ageMs ?? 0) / 60_000);
  const age = minutes === 0 ? "less than a minute" : `${minutes} min`;
  return (
    <p
      role="status"
      aria-label={`${module} update delayed`}
      className="text-sm text-fg2"
      title={health.reason ?? undefined}
    >
      Last update {age} ago; retrying.
    </p>
  );
}

export function DegradedCard({ module, lastOkAt }: { module: ModuleName; lastOkAt?: number }) {
  const label = module.charAt(0).toUpperCase() + module.slice(1);
  return (
    <section role="status" aria-label={`${label} degraded`} className="glass p-4 sm:p-6">
      <h3 className="text-xl font-bold text-fg">{label} is catching up</h3>
      <p className="mt-2 text-fg2">
        {lastOkAt === undefined ? (
          "No successful update yet."
        ) : (
          <>
            Last good update:{" "}
            <time dateTime={new Date(lastOkAt).toISOString()}>
              {new Date(lastOkAt).toISOString()}
            </time>
            .
          </>
        )}
      </p>
    </section>
  );
}

interface Props {
  module: ModuleName;
  lastOkAt?: number;
  fallback?: ReactNode;
  children: ReactNode;
  health: ModuleHealthState;
}
export class ModuleBoundaryClient extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    console.warn(`${this.props.module} rendering failed; showing its degraded card`);
  }
  render() {
    if (this.state.failed)
      return (
        this.props.fallback ?? (
          <DegradedCard module={this.props.module} lastOkAt={this.props.lastOkAt} />
        )
      );
    return (
      <ModuleHealthContext.Provider value={this.props.health}>
        {this.props.health.degraded && (
          <UpdateNotice module={this.props.module} health={this.props.health} />
        )}
        {this.props.children}
      </ModuleHealthContext.Provider>
    );
  }
}
