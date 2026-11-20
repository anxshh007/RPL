import React, { useState, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  Node,
  Edge,
  MarkerType,
  Position,
} from 'reactflow';
import type {
  ImpactReport,
  AffectedFile,
  GraphNode,
  GraphEdge,
  RiskLevel,
  Confidence,
} from '../../shared/contracts';
import {
  IconGitBranch,
  IconChevronDown,
  IconChevronRight,
  IconX,
} from './Icons';

export interface ImpactPanelProps {
  report?: ImpactReport;
}

export function getRiskColors(risk?: RiskLevel): { bg: string; border: string; text: string } {
  switch (risk) {
    case 'high':
      return { bg: 'var(--rp-risk-high-bg, #ffebe9)', border: 'var(--rp-risk-high-border, #ff8182)', text: 'var(--rp-risk-high-text, #cf222e)' };
    case 'medium':
      return { bg: 'var(--rp-risk-medium-bg, #fff8c5)', border: 'var(--rp-risk-medium-border, #d4a72c)', text: 'var(--rp-risk-medium-text, #9a6700)' };
    case 'low':
      return { bg: 'var(--rp-risk-low-bg, #ddf4ff)', border: 'var(--rp-risk-low-border, #54aeff)', text: 'var(--rp-risk-low-text, #0969da)' };
    default:
      return { bg: 'var(--rp-risk-none-bg, #f6f8fa)', border: 'var(--rp-risk-none-border, #d0d7de)', text: 'var(--rp-risk-none-text, #57606a)' };
  }
}

export function getConfidenceBadge(confidence?: Confidence): { label: string; bg: string; text: string } {
  switch (confidence) {
    case 'high':
      return { label: 'High Conf.', bg: 'var(--rp-conf-high-bg, #dafbe1)', text: 'var(--rp-conf-high-text, #1a7f37)' };
    case 'medium':
      return { label: 'Med Conf.', bg: 'var(--rp-risk-medium-bg, #fff8c5)', text: 'var(--rp-risk-medium-text, #9a6700)' };
    case 'low':
      return { label: 'Low Conf.', bg: 'var(--rp-risk-none-bg, #f6f8fa)', text: 'var(--rp-risk-none-text, #57606a)' };
    default:
      return { label: 'Unknown', bg: 'var(--rp-risk-none-bg, #f6f8fa)', text: 'var(--rp-risk-none-text, #57606a)' };
  }
}

export function buildImpactFlowGraph(report: ImpactReport): { nodes: Node[]; edges: Edge[] } {
  const { nodes = [], edges = [], changedTargets = [], affectedFiles = [] } = report;
  const changedSet = new Set(changedTargets);
  const posMap = new Map<string, { col: number; row: number }>();
  const colCounters: number[] = [0, 0, 0, 0];

  nodes.forEach((n) => {
    let col = 0;
    if (changedSet.has(n.id) || n.highlight === 'changed') {
      col = 2; // target on right
    } else {
      const aff = affectedFiles.find((a) => a.path === n.id);
      const hops = aff ? aff.relationshipPath.length - 1 : 1;
      col = Math.max(0, 2 - hops);
    }
    const row = colCounters[col]++;
    posMap.set(n.id, { col, row });
  });

  const flowNodes: Node[] = nodes.map((node: GraphNode) => {
    const isChanged = node.highlight === 'changed';
    const riskColors = getRiskColors(node.risk);
    const pos = posMap.get(node.id) || { col: 0, row: 0 };
    const x = pos.col * 220 + 30;
    const y = pos.row * 90 + 30;

    return {
      id: node.id,
      position: { x, y },
      // Dependants sit left of what they depend on, and arrows run dependant → dependency,
      // so an arrow leaves a box on its right side and enters the next box on its left side.
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: (
          <div className="p-1 font-mono text-left">
            <div className="font-semibold text-xs flex items-center justify-between gap-1.5">
              <span className="truncate max-w-[140px]" title={node.path || node.id}>
                {node.label || node.id}
              </span>
              {node.risk && (
                <span
                  className="text-[9px] uppercase px-1.5 py-0.2 rounded font-bold border"
                  style={{
                    backgroundColor: riskColors.bg,
                    color: riskColors.text,
                    borderColor: riskColors.border,
                  }}
                >
                  {node.risk}
                </span>
              )}
            </div>
            <div className="text-[10px] text-gray-500 truncate" title={node.id}>
              {isChanged ? '● Changed target' : `Kind: ${node.kind}`}
            </div>
          </div>
        ),
      },
      style: {
        backgroundColor: isChanged ? 'var(--rp-changed-bg, #fbefff)' : riskColors.bg,
        borderColor: isChanged ? 'var(--rp-changed-border, #8250df)' : riskColors.border,
        borderWidth: isChanged ? '2px' : '1px',
        borderRadius: '8px',
        padding: '6px 8px',
        width: 190,
        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
        fontSize: '11px',
      },
    };
  });

  const flowEdges: Edge[] = edges.map((edge: GraphEdge) => {
    const isInferred = edge.evidence === 'inferred';
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      animated: isInferred,
      label: edge.kind,
      labelStyle: { fill: 'var(--rp-edge, #57606a)', fontSize: 10, fontFamily: 'monospace' },
      style: {
        stroke: isInferred ? 'var(--rp-edge-inferred, #9a6700)' : 'var(--rp-edge, #57606a)',
        strokeWidth: 1.5,
        strokeDasharray: isInferred ? '5,5' : undefined,
      },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: isInferred ? 'var(--rp-edge-inferred, #9a6700)' : 'var(--rp-edge, #57606a)',
      },
    };
  });

  return { nodes: flowNodes, edges: flowEdges };
}

export const ImpactPanel: React.FC<ImpactPanelProps> = ({ report }) => {
  const [activeTab, setActiveTab] = useState<'graph' | 'list'>('graph');
  const [showLimitations, setShowLimitations] = useState(false);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const { nodes: flowNodes, edges: flowEdges } = useMemo(() => {
    if (!report) return { nodes: [], edges: [] };
    return buildImpactFlowGraph(report);
  }, [report]);

  if (!report) {
    return null;
  }

  const { summary, affectedFiles = [], warnings = [], limitations = [] } = report;

  return (
    <div
      className="rounded-lg border overflow-hidden text-xs shadow-sm font-sans"
      style={{
        backgroundColor: 'var(--vscode-editor-background, #ffffff)',
        borderColor: 'var(--vscode-panel-border, #d0d7de)',
      }}
    >
      {/* Header Bar */}
      <div
        className="px-3.5 py-2.5 border-b flex items-center justify-between"
        style={{
          backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
          borderColor: 'var(--vscode-panel-border, #d0d7de)',
        }}
      >
        <div className="flex items-center gap-2">
          <IconGitBranch size={16} className="text-purple-600" />
          <span className="font-semibold" style={{ color: 'var(--vscode-editor-foreground, #1f2328)' }}>
            IMPACTLENS PREDICTIVE REPORT
          </span>
          {summary.incomplete && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-semibold border border-amber-300">
              Incomplete Analysis
            </span>
          )}
        </div>

        {/* View Toggle */}
        <div className="inline-flex rounded border p-0.5" style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}>
          <button
            type="button"
            onClick={() => setActiveTab('graph')}
            className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition ${
              activeTab === 'graph'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Graph ({flowNodes.length} nodes)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('list')}
            className={`px-2.5 py-0.5 rounded text-[11px] font-medium transition ${
              activeTab === 'list'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Affected Files ({affectedFiles.length})
          </button>
        </div>
      </div>

      {/* Summary Metrics Bar */}
      <div
        className="px-3.5 py-2 border-b grid grid-cols-5 gap-2 text-center text-[11px] font-mono"
        style={{
          backgroundColor: 'var(--vscode-editor-background, #ffffff)',
          borderColor: 'var(--vscode-panel-border, #d0d7de)',
        }}
      >
        <div className="p-1 rounded bg-gray-50 border border-gray-200">
          <div className="text-gray-500 text-[10px]">ANALYSED</div>
          <div className="font-bold text-gray-900">{summary.analysedFiles}</div>
        </div>
        <div className="p-1 rounded bg-gray-50 border border-gray-200">
          <div className="text-gray-500 text-[10px]">AFFECTED</div>
          <div className="font-bold text-gray-900">{summary.affectedCount}</div>
        </div>
        <div className="p-1 rounded bg-red-50 border border-red-200">
          <div className="text-red-700 text-[10px] font-semibold">HIGH RISK</div>
          <div className="font-bold text-red-700">{summary.high}</div>
        </div>
        <div className="p-1 rounded bg-amber-50 border border-amber-200">
          <div className="text-amber-700 text-[10px] font-semibold">MEDIUM</div>
          <div className="font-bold text-amber-700">{summary.medium}</div>
        </div>
        <div className="p-1 rounded bg-blue-50 border border-blue-200">
          <div className="text-blue-700 text-[10px] font-semibold">LOW</div>
          <div className="font-bold text-blue-700">{summary.low}</div>
        </div>
      </div>

      {/* Warnings Banner if any */}
      {warnings.length > 0 && (
        <div className="p-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-[11px] space-y-1">
          {warnings.map((w, idx) => (
            <div key={idx} className="flex items-center gap-1.5 font-mono">
              <span>⚠</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Main Content Area: Graph or List */}
      {activeTab === 'graph' ? (
        <div className="h-[280px] w-full bg-gray-50 relative border-b border-gray-200">
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            fitView
            minZoom={0.2}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#cbd5e1" gap={16} />
            <Controls showInteractive={false} position="top-right" />
          </ReactFlow>
          <div className="absolute bottom-2 left-2 text-[10px] text-gray-500 font-mono bg-white/90 px-2 py-0.5 rounded border border-gray-200 shadow-sm pointer-events-none">
            Arrows run from dependant (source) → dependency (target). Capped at 50 nodes.
          </div>
        </div>
      ) : (
        <div className="divide-y max-h-[300px] overflow-y-auto" style={{ borderColor: 'var(--vscode-panel-border, #d0d7de)' }}>
          {affectedFiles.map((file: AffectedFile) => {
            const riskColors = getRiskColors(file.risk);
            const confBadge = getConfidenceBadge(file.confidence);
            const isExpanded = expandedFile === file.path;

            return (
              <div key={file.path} className="p-3 hover:bg-gray-50 transition">
                <div
                  className="flex items-center justify-between cursor-pointer"
                  onClick={() => setExpandedFile(isExpanded ? null : file.path)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] uppercase font-bold px-2 py-0.5 rounded border"
                      style={{
                        backgroundColor: riskColors.bg,
                        color: riskColors.text,
                        borderColor: riskColors.border,
                      }}
                    >
                      {file.risk}
                    </span>
                    <span className="font-mono font-semibold text-gray-900">{file.path}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-[10px] px-2 py-0.5 rounded border"
                      style={{
                        backgroundColor: confBadge.bg,
                        color: confBadge.text,
                        borderColor: 'transparent',
                      }}
                    >
                      {confBadge.label}
                    </span>
                    <span className="text-gray-400">
                      {isExpanded ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
                    </span>
                  </div>
                </div>

                {/* Expanded Reasons & Path */}
                {isExpanded && (
                  <div className="mt-2.5 pt-2 border-t border-gray-200 text-[11px] space-y-1.5">
                    <div>
                      <span className="text-gray-500 font-semibold">Matched Rule:</span>{' '}
                      <code className="text-purple-700 bg-purple-50 px-1 py-0.5 rounded font-mono">
                        {file.matchedRule}
                      </code>
                    </div>
                    <div>
                      <span className="text-gray-500 font-semibold">Reasons:</span>
                      <ul className="list-disc pl-5 mt-0.5 space-y-0.5 text-gray-700">
                        {file.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <span className="text-gray-500 font-semibold">Dependency Path:</span>
                      <div className="font-mono text-[10px] text-gray-600 bg-gray-100 p-1.5 rounded mt-0.5 break-all">
                        {file.relationshipPath.join(' → ')}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Limitations Footer (Collapsible) */}
      <div
        className="px-3 py-2 border-t text-[11px]"
        style={{
          backgroundColor: 'var(--vscode-sideBar-background, #f6f8fa)',
          borderColor: 'var(--vscode-panel-border, #d0d7de)',
        }}
      >
        <div
          className="flex items-center justify-between cursor-pointer text-gray-500 hover:text-gray-700 select-none"
          onClick={() => setShowLimitations(!showLimitations)}
        >
          <span>Limitations &amp; Guarantees ({limitations.length})</span>
          <span>{showLimitations ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />}</span>
        </div>
        {showLimitations && (
          <ul className="mt-1.5 list-disc pl-5 space-y-0.5 text-gray-600 text-[10px]">
            {limitations.map((lim, idx) => (
              <li key={idx}>{lim}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};
