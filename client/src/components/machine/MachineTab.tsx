/**
 * @file MachineTab.tsx
 * @description The dashboard's Machine tab: subscribes to host PC metrics through
 * `useMachineMetrics` and to the agent markers through `useAgentMarkers` (only
 * while mounted), keeps the selected metric and the process sort order, and
 * renders everything through `MachineView`.
 */

import { useState } from "react";
import { useMachineMetrics } from "../../hooks/useMachineMetrics";
import { useAgentMarkers } from "../../hooks/useAgentMarkers";
import type { MachineMetric, ProcessSort } from "../../lib/machine";
import { MachineView } from "./MachineView";

export function MachineTab() {
  const state = useMachineMetrics();
  const { markers, sessions } = useAgentMarkers(state.windowMs);
  const [selected, setSelected] = useState<MachineMetric>("cpu");
  const [sort, setSort] = useState<ProcessSort>("cpu");
  return (
    <MachineView
      state={state}
      selected={selected}
      onSelect={setSelected}
      sort={sort}
      onSortChange={setSort}
      markers={markers}
      markerSessions={sessions}
    />
  );
}
