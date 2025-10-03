import React, { useMemo, useState, useEffect, useCallback } from "react";
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
// shadcn/ui（想定パス。プロジェクトのパスエイリアスに合わせて変更してください）
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Layers2, Search, Network, SquareChevronRight, Plus, Link2 } from "lucide-react";

// ===============
// 型・ユーティリティ
// ===============

type UgAny = Record<string, any>;

function v<T = any>(x: any, fallback?: T): T | undefined {
  if (x == null) return fallback;
  if (typeof x === "object" && "value" in x) return (x.value as T) ?? fallback;
  return (x as T) ?? fallback;
}

function normId(x: any): string | undefined {
  return v<string>(x?.id) || v<string>(x) || undefined;
}

function safeArray<T = any>(x: any): T[] {
  if (!x) return [];
  if (Array.isArray(x)) return x as T[];
  return [x as T];
}

// ===============
// UG → フラット化
// ===============

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

    // 局所 edges（objects 形式）
    const localEdges = safeArray<any>(base?.edges);
    for (const e of localEdges) {
      const eid = v<string>(e?.id) || `${v<string>(e?.from_id) || id}->${v<string>(e?.to_id)}`;
      const from = v<string>(e?.from_id) || id;
      const to = v<string>(e?.to_id);
      if (from && to) {
        edges.push({ id: eid, from, to, label: v<string>(e?.condition?.expression) });
      }
    }

    // adjacency 形式（配列の ID 群）にフォールバック
    const adj = safeArray<string>(base?.edges).filter((x) => typeof x === "string");
    for (const to of adj) {
      edges.push({ id: `${id}->${to}`, from: id, to });
    }
  }

  // processes → tasks/gateways/events
  for (const pid of Object.keys(procs)) {
    const p = ug.processes[pid];
    const tasks = p?.tasks || {};
    for (const tk of Object.keys(tasks)) pushNode(tasks[tk], "task", v<string>(p?.id) || pid);

    const gws = p?.gateways || {};
    for (const gk of Object.keys(gws)) pushNode(gws[gk], "gateway", v<string>(p?.id) || pid);

    const evs = p?.events || {};
    for (const ek of Object.keys(evs)) pushNode(evs[ek], "event", v<string>(p?.id) || pid);

    // process 全体の edges（トップレベル）
    const procEdges = safeArray<any>(p?.edges);
    for (const e of procEdges) {
      const eid = v<string>(e?.id) || `${v<string>(e?.from_id)}->${v<string>(e?.to_id)}`;
      const from = v<string>(e?.from_id);
      const to = v<string>(e?.to_id);
      if (from && to) edges.push({ id: eid, from, to, label: v<string>(e?.condition?.expression) });
    }
  }

  // ワークフロー直下の gateways/events/edges（あれば）
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

  // 重複エッジ・自己ループ削除
  const seen = new Set<string>();
  const dedupEdges: UgEdgeData[] = [];
  for (const e of edges) {
    if (e.from === e.to) continue; // self-loop 禁止（S1/S2の健全性に合わせる）
    const key = `${e.from}->${e.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      dedupEdges.push({ ...e, id: e.id || key });
    }
  }

  return { nodes, edges: dedupEdges, processes: procs };
}

// ===============
// レイアウト（Dagre）
// ===============

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

// ===============
// Node ビュー
// ===============

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
        <Badge variant="outline" className="uppercase tracking-wide text-[10px]">
          {data.kind}
        </Badge>
        {data.processName && <span className="text-[10px] text-slate-500">in {data.processName}</span>}
      </div>
      <div className="font-medium leading-tight truncate" title={data.name}>
        {data.name}
      </div>
      {data.description && <div className="text-xs text-slate-500 line-clamp-2 mt-1">{data.description}</div>}
      <div className="flex flex-wrap gap-1 mt-2">
        {data.tags?.slice(0, 4).map((t) => (
          <Badge key={t} variant="outline" className="text-[10px]">
            {t}
          </Badge>
        ))}
        {data.same_as && (
          <Badge variant="info" className="text-[10px]" title={data.same_as}>
            BG link
          </Badge>
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
  return "taskNode"; // task / process / unknown → task style
}

const NODE_KIND_OPTIONS: UgNodeData["kind"][] = [
  "task",
  "gateway",
  "event",
  "process",
  "pool",
  "unknown",
];

// ===============
// 右ペイン：インスペクタ
// ===============

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

// ===============
// メイン：UG Viewer
// ===============

export default function UgViewer({ ug }: { ug: UgAny }) {
  const { nodes: baseNodes, edges: baseEdges, processes } = useMemo(() => flattenUG(ug), [ug]);

  const [filter, setFilter] = useState("");
  const [clusterByProcess, setClusterByProcess] = useState(true);
  const [selected, setSelected] = useState<UgNodeData | undefined>();
  const processOptions = useMemo(() => Object.values(processes ?? {}), [processes]);
  const [newNodeId, setNewNodeId] = useState("");
  const [newNodeName, setNewNodeName] = useState("");
  const [newNodeKind, setNewNodeKind] = useState<UgNodeData["kind"]>("task");
  const [newNodeProcessId, setNewNodeProcessId] = useState("");
  const [newNodeError, setNewNodeError] = useState<string | null>(null);
  const [newEdgeSource, setNewEdgeSource] = useState("");
  const [newEdgeTarget, setNewEdgeTarget] = useState("");
  const [newEdgeLabel, setNewEdgeLabel] = useState("");
  const [newEdgeError, setNewEdgeError] = useState<string | null>(null);

  // React Flow nodes/edges
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

  const applyLayout = useCallback(
    (nodes: Node[], edges: Edge[]) => {
      const nodeCopies = nodes.map((n) => ({ ...n }));
      const edgeCopies = edges.map((e) => ({ ...e }));
      const laidOut = layout(nodeCopies, edgeCopies);

      if (clusterByProcess) {
        const byProc: Record<string, number> = {};
        let band = 0;
        for (const n of laidOut) {
          const procName = (n.data as UgNodeData)?.processName || "(no process)";
          if (!(procName in byProc)) {
            byProc[procName] = band;
            band += 280;
          }
        }
        laidOut.forEach((n) => {
          const procName = (n.data as UgNodeData)?.processName || "(no process)";
          const yoff = byProc[procName] || 0;
          n.position = { x: n.position.x, y: n.position.y + yoff };
        });
      }

      return laidOut;
    },
    [clusterByProcess]
  );

  useEffect(() => {
    const laid = applyLayout(rfNodesInit, rfEdgesInit);
    setRfNodes(laid);
    setRfEdges(rfEdgesInit);
  }, [applyLayout, rfNodesInit, rfEdgesInit, setRfNodes, setRfEdges]);

  useEffect(() => {
    if (!rfNodes.length) return;
    setRfNodes((nodes) => applyLayout(nodes, rfEdges));
  }, [applyLayout, rfEdges, rfNodes.length, setRfNodes]);

  const handleAddNode = () => {
    const rawId = newNodeId.trim();
    const id = rawId || `node-${Date.now()}`;
    if (!id) {
      setNewNodeError("IDを入力してください");
      return;
    }
    if (rfNodes.some((n) => n.id === id)) {
      setNewNodeError("同じIDのノードが既に存在します");
      return;
    }

    const name = newNodeName.trim() || id;
    const kind = newNodeKind || "task";
    const processId = newNodeProcessId || undefined;
    const nodeData: UgNodeData = {
      id,
      kind,
      name,
      processId,
      processName: processId ? processes[processId]?.name : undefined,
      same_as: null,
      tags: [],
      checklist: [],
      acceptance: [],
    };

    const node: Node = {
      id,
      type: kindToNodeType(kind) as any,
      position: { x: 0, y: 0 },
      data: nodeData,
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
    };

    setRfNodes((nodes) => applyLayout([...nodes, node], rfEdges));
    setSelected(nodeData);
    setNewNodeId("");
    setNewNodeName("");
    setNewNodeProcessId("");
    setNewNodeError(null);
  };

  const handleAddEdge = () => {
    const source = newEdgeSource.trim();
    const target = newEdgeTarget.trim();

    if (!source || !target) {
      setNewEdgeError("ソースとターゲットを選択してください");
      return;
    }
    if (source === target) {
      setNewEdgeError("ソースとターゲットは異なる必要があります");
      return;
    }

    const label = newEdgeLabel.trim();
    if (rfEdges.some((e) => e.source === source && e.target === target && (e.label ?? "") === label)) {
      setNewEdgeError("同じエッジが既に存在します");
      return;
    }

    const edge: Edge = {
      id: `edge-${Date.now()}`,
      source,
      target,
      label: label || undefined,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { strokeWidth: 1.2 },
      labelBgBorderRadius: 6,
      labelBgPadding: [2, 4],
    };

    const nextEdges = [...rfEdges, edge];
    setRfEdges(nextEdges);
    setRfNodes((nodes) => applyLayout(nodes, nextEdges));
    setNewEdgeSource("");
    setNewEdgeTarget("");
    setNewEdgeLabel("");
    setNewEdgeError(null);
  };

  const nodeOptions = useMemo(
    () =>
      rfNodes
        .map((n) => ({ id: n.id, name: (n.data as UgNodeData)?.name || n.id }))
        .sort((a, b) => a.name.localeCompare(b.name, "ja")),
    [rfNodes]
  );

  // フィルタ適用（ラベル/説明/タグ）
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

  const filteredNodes = useMemo(() => rfNodes.map((n) => ({ ...n, hidden: !visibleIds.has(n.id) })), [rfNodes, visibleIds]);
  const filteredEdges = useMemo(
    () => rfEdges.map((e) => ({ ...e, hidden: !(visibleIds.has(e.source) && visibleIds.has(e.target)) })),
    [rfEdges, visibleIds]
  );

  // 選択
  const onNodeClick = (_: any, node: Node) => {
    setSelected(node.data as UgNodeData);
  };

  return (
    <div className="w-full h-full grid grid-cols-12 gap-3 p-3 bg-neutral-50">
      {/* 左：ツールバー + Canvas */}
      <div className="col-span-8 rounded-2xl bg-white border shadow-sm overflow-hidden flex flex-col">
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
            <Button
              variant={clusterByProcess ? "default" : "secondary"}
              size="sm"
              onClick={() => setClusterByProcess(!clusterByProcess)}
            >
              <Layers2 className="w-4 h-4 mr-1" />
              {clusterByProcess ? "レーン表示: ON" : "レーン表示: OFF"}
            </Button>
          </div>
        </div>
        <div className="border-b bg-slate-50/80 px-3 py-3 space-y-4">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <Plus className="w-3.5 h-3.5" />
              ノード追加
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
              <Input
                value={newNodeId}
                onChange={(e) => {
                  setNewNodeId(e.target.value);
                  setNewNodeError(null);
                }}
                placeholder="ID（任意）"
                className="h-9 text-sm"
              />
              <Input
                value={newNodeName}
                onChange={(e) => {
                  setNewNodeName(e.target.value);
                  setNewNodeError(null);
                }}
                placeholder="名前"
                className="h-9 text-sm md:col-span-1"
              />
              <select
                value={newNodeKind}
                onChange={(e) => {
                  setNewNodeKind(e.target.value as UgNodeData["kind"]);
                  setNewNodeError(null);
                }}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                {NODE_KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <select
                value={newNodeProcessId}
                onChange={(e) => {
                  setNewNodeProcessId(e.target.value);
                  setNewNodeError(null);
                }}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="">プロセス（任意）</option>
                {processOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              {newNodeError && <div className="text-[11px] text-rose-500">{newNodeError}</div>}
              <Button size="sm" className="ml-auto" onClick={handleAddNode}>
                追加
              </Button>
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
              <Link2 className="w-3.5 h-3.5" />
              エッジ追加
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-4">
              <select
                value={newEdgeSource}
                onChange={(e) => {
                  setNewEdgeSource(e.target.value);
                  setNewEdgeError(null);
                }}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="">ソースノード</option>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
              <select
                value={newEdgeTarget}
                onChange={(e) => {
                  setNewEdgeTarget(e.target.value);
                  setNewEdgeError(null);
                }}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="">ターゲットノード</option>
                {nodeOptions.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
              <Input
                value={newEdgeLabel}
                onChange={(e) => {
                  setNewEdgeLabel(e.target.value);
                  setNewEdgeError(null);
                }}
                placeholder="ラベル（任意）"
                className="h-9 text-sm md:col-span-2"
              />
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              {newEdgeError && <div className="text-[11px] text-rose-500">{newEdgeError}</div>}
              <Button size="sm" className="ml-auto" onClick={handleAddEdge}>
                接続
              </Button>
            </div>
          </div>
        </div>
        <div className="flex-1 min-h-[360px]">
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

      {/* 右：インスペクタ */}
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

// 使い方（Next.js のページ等で）
// <UgViewer ug={yourUgJsonObject} />
