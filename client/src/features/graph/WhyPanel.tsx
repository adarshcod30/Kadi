// WhyPanel — right-side contextual panel: edge evidence ("Why linked") or node detail.
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, ArrowRight, X } from 'lucide-react';
import type { GraphNode, GraphEdge } from '../../lib/types';
import { Chip, RiskBadge, Mono } from '../../components/ui';
import { EDGE_COLOR } from './GraphCanvas';

const TYPE_LABEL: Record<string, string> = {
  shared_offender: 'Shared offender', co_accused: 'Co-accused', mo_similarity: 'Similar MO',
  same_location: 'Same location', same_timewindow: 'Same time window', shared_section: 'Shared section',
  appears_in: 'Appears in',
};

export function WhyPanel({ node, edge, onClose, fairness }: {
  node?: GraphNode | null; edge?: GraphEdge | null; onClose: () => void; fairness?: string;
}) {
  const nav = useNavigate();
  if (!node && !edge) {
    return (
      <div className="p-4 text-sm text-ink-muted">
        <div className="font-medium text-ink mb-1">Explore the network</div>
        Click a node to see its detail, or an edge to see <b>why two cases are linked</b> — with the exact matching attributes and source FIRs.
        {fairness && <div className="mt-4 flex gap-2 text-xs bg-kadi-blue50 text-kadi-navy700 rounded-ctl p-2"><ShieldCheck size={14} className="shrink-0 mt-0.5" />{fairness}</div>}
      </div>
    );
  }

  if (edge) {
    return (
      <div className="p-4">
        <Header title="Why linked?" onClose={onClose} />
        <div className="flex flex-wrap gap-1 mb-3">
          {(edge.allTypes || [edge.edgeType]).map((t) => (
            <span key={t} className="chip text-white" style={{ background: EDGE_COLOR[t] || '#94A3B8' }}>{TYPE_LABEL[t] || t}</span>
          ))}
          <Chip>strength {edge.strength.toFixed(2)}</Chip>
        </div>
        {edge.explanation?.sourceFIRs && (
          <div className="text-xs text-ink-muted mb-2">Source FIRs: {edge.explanation.sourceFIRs.map((f) => <Mono key={f}>{f} </Mono>)}</div>
        )}
        <div className="space-y-2">
          {(edge.explanation?.matched || []).map((m, i) => (
            <div key={i} className="border border-line rounded-ctl p-2.5">
              <div className="text-xs font-medium" style={{ color: EDGE_COLOR[m.type] || '#1C2A3A' }}>{TYPE_LABEL[m.type] || m.type}</div>
              <div className="text-sm text-ink mt-0.5">{m.detail}</div>
              {m.offenderIds && m.offenderIds.map((oid) => (
                <button key={oid} onClick={() => nav(`/offenders/${oid}`)} className="link text-xs mt-1 flex items-center gap-1">
                  Open offender profile <ArrowRight size={12} />
                </button>
              ))}
            </div>
          ))}
        </div>
        <FairnessNote text={fairness} />
      </div>
    );
  }

  // node
  const n = node!;
  return (
    <div className="p-4">
      <Header title={n.type === 'case' ? 'FIR detail' : 'Offender'} onClose={onClose} />
      {n.type === 'case' ? (
        <div className="space-y-2">
          <Mono>{n.label}</Mono>
          <div className="text-sm">{n.crimeSubHead} · <span className="text-ink-muted">{n.crimeHead}</span></div>
          <div className="text-xs text-ink-muted">{n.unit}, {n.district} · {n.date}</div>
          <div className="flex gap-1"><Chip color="blue">{n.status}</Chip>{n.gravity && <Chip color={n.gravity.toLowerCase().includes('non') ? 'default' : 'red'}>{n.gravity}</Chip>}</div>
          <button onClick={() => nav(`/cases/${n.caseId}`)} className="btn-outline mt-2 text-sm">Open full case <ArrowRight size={14} /></button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="font-medium">{n.label}</div>
          <RiskBadge score={n.riskScore} band={n.band} />
          <div className="text-xs text-ink-muted">{n.cases} linked cases</div>
          <button onClick={() => nav(`/offenders/${n.offenderId}`)} className="btn-outline mt-2 text-sm">Open profile <ArrowRight size={14} /></button>
        </div>
      )}
      <FairnessNote text={fairness} />
    </div>
  );
}

function Header({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="font-semibold text-ink">{title}</h3>
      <button onClick={onClose} className="text-ink-muted hover:text-ink"><X size={16} /></button>
    </div>
  );
}
function FairnessNote({ text }: { text?: string }) {
  if (!text) return null;
  return <div className="mt-4 flex gap-2 text-xs bg-kadi-blue50 text-kadi-navy700 rounded-ctl p-2"><ShieldCheck size={14} className="shrink-0 mt-0.5" />{text}</div>;
}
