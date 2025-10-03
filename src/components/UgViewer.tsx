import React, { useMemo, useState, useEffect } from "react";
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Position,
  MarkerType,
  useNodesState,
  useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Layers2, Search, Network, SquareChevronRight } from "lucide-react";

export type UgAny = Record<string, any>;

function v<T = any>(x: any, fallback?: T): T | undefined {
  if (x == null) return fallback;
  if (typeof x === "object" && "value" in x) return (x.value as T) ?? fallback;
  return (x as T) ?? fallback;
}

function safeArray<T = any>(x: any): T[] {
  if (!x) return [];
  if (Array.isArray(x)) return x as T[];
  return [x as T];
}

export type UgNodeData = {
  id: string;
  kind: "task" | "gateway" | "event" | "process" | "pool" | "unknown";
  name: string;
  description?: string;
  processId?: string;
  processName?: string;
  poolId?: string;
  same_as?: string | null;
  tags?: string[];
  roles?: any;
  sla?: any;
  checklist?: any[];
  acceptance?: any[];
  evidence?: any;
  controls?: any;
  note?: string;
};

export type UgEdgeData = {
  id: string;
  from: string;
  to: string;
  label?: string;
};

function collectProcesses(ug: UgAny): Record<string, { id: string; name: string }> {
  const out: Record<string, { id: string; name: string }> = {};
  const procs = ug?.processes || {};
  for (const k of Object.keys(procs)) {
    const p = procs[k];
    const id = v<string>(p?.id) || k;
    if (!id) continue;
    out[id] = { id, name: v<string>(p?.name) || id };
  }
  return out;
}

function flattenUG(ug: UgAny) {
  const nodes: UgNodeData[] = [];
  const edges: UgEdgeData[] = [];
  const procs = collectProcesses(ug);

  function pushNode(base: any, kind: UgNodeData["kind"], ownerProcessId?: string) {
    const id = v<string>(base?.id);
    if (!id) return;
    const n: UgNodeData = {
      id,
      kind,
      name: v<string>(base?.name) || kind.toUpperCase(),
      description: v<string>(base?.detail) || v<string>(base?.summary),
      processId: ownerProcessId,
      processName: ownerProcessId ? procs[ownerProcessId]?.name : undefined,
      same_as: v<string>(base?.same_as) || null,
      tags: safeArray<string>(base?.tags),
      roles: base?.roles,
      sla: base?.sla,
      checklist: safeArray(base?.checklist),
      acceptance: safeArray(base?.acceptance),
      evidence: base?.evidence,
      controls: base?.controls,
      note: base?.note,
    };
    nodes.push(n);

    const localEdges = safeArray<any>(base?.edges);
    for (const e of localEdges) {
      const eid = v<string>(e?.id) || `${v<string>(e?.from_id) || id}->${v<string>(e?.to_id)}`;
      const from = v<string>(e?.from_id) || id;
      const to = v<string>(e?.to_id);
      if (from && to) {
        edges.push({ id: eid, from, to, label: v<string>(e?.condition?.expression) });
      }
    }

    const adj = safeArray<string>(base?.edges).filter((x) => typeof x === "string");
    for (const to of adj) {
      edges.push({ id: `${id}->${to}`, from: id, to });
    }
  }

  for (const pid of Object.keys(procs)) {
    const p = ug.processes[pid];
    const tasks = p?.tasks || {};
    for (const tk of Object.keys(tasks)) pushNode(tasks[tk], "task", v<string>(p?.id) || pid);

    const gws = p?.gateways || {};
    for (const gk of Object.keys(gws)) pushNode(gws[gk], "gateway", v<string>(p?.id) || pid);

    const evs = p?.events || {};
    for (const ek of Object.keys(evs)) pushNode(evs[ek], "event", v<string>(p?.id) || pid);

    const procEdges = safeArray<any>(p?.edges);
    for (const e of procEdges) {
      const eid = v<string>(e?.id) || `${v<string>(e?.from_id)}->${v<string>(e?.to_id)}`;
      const from = v<string>(e?.from_id);
      const to = v<string>(e?.to_id);
      if (from && to) edges.push({ id: eid, from, to, label: v<string>(e?.condition?.expression) });
    }
  }

  const wfGws = ug?.gateways || {};
  for (const g of Object.keys(wfGws)) pushNode(wfGws[g], "gateway");
  const wfEvs = ug?.events || {};
  for (const e of Object.keys(wfEvs)) pushNode(wfEvs[e], "event");
  const wfEdges = safeArray<any>(ug?.edges);
  for (const e of wfEdges) {
    const eid = v<string>(e?.id) || `${v<string>(e?.from_id)}->${v<string>(e?.to_id)}`;
    const from = v<string>(e?.from_id);
    const to = v<string>(e?.to_id);
    if (from && to) edges.push({ id: eid, from, to, label: v<string>(e?.condition?.expression) });
  }

  const seen = new Set<string>();
  const dedupEdges: UgEdgeData[] = [];
  for (const e of edges) {
    if (e.from === e.to) continue;
    const key = `${e.from}->${e.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupEdges.push({ ...e, id: e.id || key });
    }
  }

  return { nodes, edges: dedupEdges, processes: procs };
}

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

type LayoutOpts = {
  rankdir?: "LR" | "TB";
  nodeSep?: number;
  rankSep?: number;
};

function layout(nodes: Node[], edges: Edge[], opts: LayoutOpts = {}) {
  const { rankdir = "LR", nodeSep = 80, rankSep = 140 } = opts;
  dagreGraph.setGraph({ rankdir, nodesep: nodeSep, ranksep: rankSep });

  nodes.forEach((n) => {
    dagreGraph.setNode(n.id, { width: (n.width ?? 260) + 24, height: (n.height ?? 112) + 24 });
  });
  edges.forEach((e) => {
    dagreGraph.setEdge(e.source, e.target);
  });

  dagre.layout(dagreGraph);

  return nodes.map((n) => {
    const p = dagreGraph.node(n.id);
    n.position = { x: p.x - (n.width ?? 260) / 2, y: p.y - (n.height ?? 112) / 2 };
    return n;
  });
}

function NodeCard({ data }: { data: UgNodeData }) {
  const accent =
    data.kind === "gateway"
      ? "border-yellow-400"
      : data.kind === "event"
      ? "border-emerald-400"
      : data.kind === "task"
      ? "border-sky-500"
      : "border-slate-300";
  return (
    <div className={`rounded-2xl shadow-sm border ${accent} bg-white p-3 w-[260px]`}>
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100">{data.kind}</span>
        {data.processName && <span className="text-[10px] text-slate-500">in {data.processName}</span>}
      </div>
      <div className="font-medium leading-tight truncate" title={data.name}>
        {data.name}
      </div>
      {data.description && <div className="text-xs text-slate-500 line-clamp-2 mt-1">{data.description}</div>}
      <div className="flex flex-wrap gap-1 mt-2">
        {data.tags?.slice(0, 4).map((t) => (
          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-50 border border-slate-200">
            {t}
          </span>
        ))}
        {data.same_as && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 border border-indigo-200" title={data.same_as}>
            BG link
          </span>
        )}
      </div>
    </div>
  );
}

const nodeTypes = {
  taskNode: ({ data }: { data: UgNodeData }) => <NodeCard data={data} />,
  gatewayNode: ({ data }: { data: UgNodeData }) => <NodeCard data={data} />,
  eventNode: ({ data }: { data: UgNodeData }) => <NodeCard data={data} />,
};

function kindToNodeType(kind: UgNodeData["kind"]) {
  if (kind === "gateway") return "gatewayNode";
  if (kind === "event") return "eventNode";
  return "taskNode";
}

function Inspector({ selection }: { selection?: UgNodeData }) {
  if (!selection) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <div className="flex items-center gap-2 text-sm">
          <SquareChevronRight className="w-4 h-4" /> ノードを選択
        </div>
      </div>
    );
  }
  return (
    <ScrollArea className="h-full">
      <Card className="border-0 shadow-none">
        <CardHeader>
          <CardTitle className="text-base">{selection.name}</CardTitle>
          <div className="text-xs text-slate-500">
            {selection.kind}
            {selection.processName ? ` · ${selection.processName}` : ""}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {selection.description && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">概要</div>
              <div className="text-sm text-slate-700 whitespace-pre-wrap">{selection.description}</div>
            </div>
          )}

          {selection.roles && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">RACI</div>
              <pre className="text-[11px] bg-slate-50 p-2 rounded border overflow-x-auto">{JSON.stringify(selection.roles, null, 2)}</pre>
            </div>
          )}

          {selection.sla && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">SLA</div>
              <pre className="text-[11px] bg-slate-50 p-2 rounded border overflow-x-auto">{JSON.stringify(selection.sla, null, 2)}</pre>
            </div>
          )}

          {selection.checklist && selection.checklist.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">チェックリスト</div>
              <ul className="space-y-1 text-sm list-disc pl-4">
                {selection.checklist.map((c: any, i: number) => (
                  <li key={i} className="text-slate-700">
                    {c?.text || JSON.stringify(c)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {selection.acceptance && selection.acceptance.length > 0 && (
            <div>
              <div className="text-xs font-medium text-slate-600 mb-1">受入基準</div>
              <ul className="space-y-1 text-sm list-disc pl-4">
                {selection.acceptance.map((c: any, i: number) => (
                  <li key={i} className="text-slate-700">
                    {String(c)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {(selection.evidence || selection.controls) && (
            <div className="grid grid-cols-1 gap-3">
              {selection.evidence && (
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-1">Evidence</div>
                  <pre className="text-[11px] bg-slate-50 p-2 rounded border overflow-x-auto">{JSON.stringify(selection.evidence, null, 2)}</pre>
                </div>
              )}
              {selection.controls && (
                <div>
                  <div className="text-xs font-medium text-slate-600 mb-1">Controls</div>
                  <pre className="text-[11px] bg-slate-50 p-2 rounded border overflow-x-auto">{JSON.stringify(selection.controls, null, 2)}</pre>
                </div>
              )}
            </div>
          )}

          <Separator />
          <div className="text-[11px] text-slate-500">
            ID: <span className="font-mono">{selection.id}</span>
          </div>
          {selection.same_as && (
            <div className="text-[11px] text-indigo-600 truncate" title={selection.same_as}>
              same_as: {selection.same_as}
            </div>
          )}
          {selection.note && <div className="text-[11px] text-amber-600">note: {selection.note}</div>}
        </CardContent>
      </Card>
    </ScrollArea>
  );
}

export default function UgViewer({ ug }: { ug: UgAny }) {
  const { nodes: baseNodes, edges: baseEdges } = useMemo(() => flattenUG(ug), [ug]);

  const [filter, setFilter] = useState("");
  const [clusterByProcess, setClusterByProcess] = useState(true);
  const [selected, setSelected] = useState<UgNodeData | undefined>();

  const rfNodesInit: Node[] = useMemo(() => {
    return baseNodes.map((n) => ({
      id: n.id,
      type: kindToNodeType(n.kind) as any,
      position: { x: 0, y: 0 },
      data: n,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    }));
  }, [baseNodes]);

  const rfEdgesInit: Edge[] = useMemo(() => {
    return baseEdges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      label: e.label,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.2 },
      labelBgBorderRadius: 6,
      labelBgPadding: [2, 4],
    }));
  }, [baseEdges]);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(rfNodesInit);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(rfEdgesInit);

  useEffect(() => {
    const laid = layout([...rfNodesInit], [...rfEdgesInit]);

    if (clusterByProcess) {
      const byProc: Record<string, number> = {};
      let band = 0;
      for (const n of laid) {
        const procName = (n.data as UgNodeData)?.processName || "(no process)";
        if (!(procName in byProc)) {
          byProc[procName] = band;
          band += 280;
        }
      }
      laid.forEach((n) => {
        const procName = (n.data as UgNodeData)?.processName || "(no process)";
        const yoff = byProc[procName] || 0;
        n.position = { x: n.position.x, y: n.position.y + yoff };
      });
    }

    setRfNodes(laid);
    setRfEdges(rfEdgesInit);
  }, [rfNodesInit, rfEdgesInit, clusterByProcess, setRfNodes, setRfEdges]);

  const visibleIds = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return new Set(rfNodes.map((n) => n.id));
    const ids = new Set<string>();
    for (const n of rfNodes) {
      const d = n.data as UgNodeData;
      const text = [d.name, d.description, d.processName, ...(d.tags || [])].join("\n").toLowerCase();
      if (text.includes(q)) ids.add(n.id);
    }
    return ids;
  }, [filter, rfNodes]);

  const filteredNodes = useMemo(
    () => rfNodes.map((n) => ({ ...n, hidden: !visibleIds.has(n.id) })),
    [rfNodes, visibleIds]
  );
  const filteredEdges = useMemo(
    () => rfEdges.map((e) => ({ ...e, hidden: !(visibleIds.has(e.source) && visibleIds.has(e.target)) })),
    [rfEdges, visibleIds]
  );

  const onNodeClick = (_: React.MouseEvent, node: Node) => {
    setSelected(node.data as UgNodeData);
  };

  return (
    <div className="w-full h-full grid grid-cols-12 gap-3 p-3 bg-neutral-50">
      <div className="col-span-8 rounded-2xl bg-white border shadow-sm overflow-hidden">
        <div className="p-2 border-b flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Network className="w-4 h-4 text-slate-600" />
            <div className="text-sm font-medium">UG Graph</div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="検索（名前 / 説明 / タグ / プロセス）"
                className="pl-8 w-[300px]"
              />
              <Search className="w-4 h-4 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
            </div>
            <Button variant={clusterByProcess ? "default" : "secondary"} size="sm" onClick={() => setClusterByProcess(!clusterByProcess)}>
              <Layers2 className="w-4 h-4 mr-1" />
              {clusterByProcess ? "レーン表示: ON" : "レーン表示: OFF"}
            </Button>
          </div>
        </div>
        <div className="h-[calc(100vh-180px)]">
          <ReactFlow
            nodes={filteredNodes}
            edges={filteredEdges}
            nodeTypes={nodeTypes as any}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            fitView
            fitViewOptions={{ padding: 0.2 }}
          >
            <Background gap={16} size={1} />
            <MiniMap zoomable pannable />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      </div>

      <div className="col-span-4 rounded-2xl bg-white border shadow-sm overflow-hidden">
        <div className="p-2 border-b flex items-center gap-2">
          <div className="flex items-center gap-2">
            <SquareChevronRight className="w-4 h-4 text-slate-600" />
            <div className="text-sm font-medium">Inspector</div>
          </div>
        </div>
        <div className="h-[calc(100vh-180px)]">
          <Inspector selection={selected} />
        </div>
      </div>
    </div>
  );
}
