"use client";

import Link from "next/link";
import { useNexusMachine } from "@/app/context/machine-context";
import { FlowGraph } from "../../components/FlowGraph";

export default function GraphPage() {
  const { state, nodeLog } = useNexusMachine();

  const active = Object.values(nodeLog).filter((e) => e.status === "active").length;
  const done = Object.values(nodeLog).filter((e) => e.status === "done").length;

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 text-sm font-bold text-white">
            N
          </div>
          <div>
            <h1 className="text-sm font-semibold text-slate-900">State Graph</h1>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]">
                {JSON.stringify(state.value)}
              </code>
              <span className="text-slate-300">|</span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500" />
                {active} active
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-400" />
                {done} done
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-[10px] text-slate-500">
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-green-600 bg-green-100" />Active</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-slate-400 bg-slate-100" />Done</span>
            <span className="flex items-center gap-1"><span className="inline-block h-2.5 w-2.5 rounded-full border-2 border-gray-300 bg-white" />Waiting</span>
          </div>
          <Link href="/" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
            Back
          </Link>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-4">
        <FlowGraph nodeLog={nodeLog} />
      </main>
    </div>
  );
}
