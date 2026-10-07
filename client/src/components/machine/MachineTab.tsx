/**
 * @file MachineTab.tsx
 * @description The dashboard's Machine tab: subscribes to host PC metrics through
 * `useMachineMetrics` (only while mounted) and keeps the selected metric and the
 * process sort order, rendering everything through `MachineView`.
 */

import { useState } from "react";
import { useMachineMetrics } from "../../hooks/useMachineMetrics";
import type { MachineMetric, ProcessSort } from "../../lib/machine";
import { MachineView } from "./MachineView";

export function MachineTab() {
  const state = useMachineMetrics();
  const [selected, setSelected] = useState<MachineMetric>("cpu");
  const [sort, setSort] = useState<ProcessSort>("cpu");
  return (
    <MachineView
      state={state}
      selected={selected}
      onSelect={setSelected}
      sort={sort}
      onSortChange={setSort}
    />
  );
}
