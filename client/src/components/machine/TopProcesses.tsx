/**
 * @file TopProcesses.tsx
 * @description Machine-mode table of the 8 heaviest host processes, sortable by
 * CPU or RAM from the column headers; `claude` processes get an accent badge and
 * a tinted row so agent work stands out.
 */

import { useTranslation } from "react-i18next";
import { isClaudeProcess, topProcesses, type ProcessSort } from "../../lib/machine";
import type { MachineProcesses } from "../../lib/types";
import { formatBytes, formatPercent } from "./machineFormat";

interface TopProcessesProps {
  processes: MachineProcesses | null;
  sort: ProcessSort;
  onSortChange: (sort: ProcessSort) => void;
}

export function TopProcesses({ processes, sort, onSortChange }: TopProcessesProps) {
  const { t, i18n } = useTranslation("dashboard");
  const lng = i18n.language;
  const rows = processes ? topProcesses(processes.items, sort) : [];

  const header = (column: ProcessSort) => {
    const active = sort === column;
    const text = t(`machine.processes.${column}`);
    return (
      <th
        scope="col"
        aria-sort={active ? "descending" : "none"}
        className="px-3 py-2 text-right font-medium"
      >
        <button
          type="button"
          onClick={() => onSortChange(column)}
          title={t("machine.processes.sortBy", { column: text })}
          className={`inline-flex items-center gap-1 transition-colors ${
            active ? "text-accent" : "text-gray-500 hover:text-gray-300"
          }`}
        >
          {text}
          <span aria-hidden="true" className={active ? "" : "invisible"}>
            ↓
          </span>
        </button>
      </th>
    );
  };

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-gray-200">{t("machine.processes.title")}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-xs text-gray-500 text-center">
          {t("machine.processes.empty")}
        </p>
      ) : (
        <table className="w-full text-xs">
          <thead className="text-gray-500">
            <tr className="border-b border-border">
              <th scope="col" className="px-3 py-2 text-left font-medium">
                {t("machine.processes.name")}
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                {t("machine.processes.pid")}
              </th>
              {header("cpu")}
              {header("ram")}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const claude = isClaudeProcess(p.name);
              return (
                <tr
                  key={p.pid}
                  data-testid="machine-process-row"
                  data-claude={claude || undefined}
                  className={`border-b border-border last:border-b-0 ${claude ? "bg-accent/5" : ""}`}
                >
                  <td className="px-3 py-1.5 text-gray-200">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="truncate font-mono">{p.name}</span>
                      {claude && (
                        <span className="flex-shrink-0 rounded-full bg-accent/15 text-accent px-1.5 py-px text-[10px] font-medium">
                          {t("machine.processes.claudeBadge")}
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-gray-500">{p.pid}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-gray-300">
                    {formatPercent(p.cpuPercent, lng, 1)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-gray-300">
                    {formatBytes(p.memoryBytes, lng)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
