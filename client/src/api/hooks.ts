// React Query hooks over the KADI API.
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, qs, getRole, districtParam } from '../lib/api';
import type {
  Me, CaseRow, CaseDetailResult, Paged, GraphData, Offender, HealthRow, Stats, Alert,
  Hotspot, AssistantResponse, Lookups,
} from '../lib/types';

// Role AND drilled district both go in every query key. Without the district, drilling into
// Kalaburagi would serve Bengaluru's cached rows back.
//
// This applies to anything the server scopes -- which is now most endpoints. socio and
// forecast were the dangerous pair: both became district-aware while still keyed on a bare
// name with staleTime: Infinity, so a drilled-in officer would have been shown the previous
// district's figures under their own heading, permanently. Global lookups (the district
// list, national outlines, map geometry) are the only ones that legitimately omit it.
const role = () => `${getRole()}:${districtParam() || 'state'}`;

export const useMe = () => useQuery({ queryKey: ['me', role()], queryFn: () => api.get<Me>('/me') });
export const useLookups = () => useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/lookups'), staleTime: Infinity });
export const useStats = () => useQuery({ queryKey: ['stats', role()], queryFn: () => api.get<Stats>('/stats') });
export const useAlerts = () => useQuery({ queryKey: ['alerts', role()], queryFn: () => api.get<Alert[]>('/alerts') });
export const useStations = (params: Record<string, unknown> = {}) =>
  useQuery({
    queryKey: ['stations', role(), params],
    queryFn: () => api.get<{
      items: any[]; total: number; scope: 'state' | 'district';
      summary: Record<string, number>; mappable: number;
    }>(`/stations${qs(params)}`),
  });

export const useAnomalies = (limit = 12) =>
  useQuery({
    queryKey: ['anomalies', role(), limit],
    queryFn: () => api.get<{
      cases: any[]; caseTotal: number; stations: any[]; stationTotal: number;
      scope: 'state' | 'district';
    }>(`/anomalies${qs({ limit })}`),
  });

// Deliberately its own query: Zia is an external call, and the case view must not wait on it.
export const useCaseEntities = (id?: string) =>
  useQuery({
    queryKey: ['case-entities', id],
    queryFn: () => api.get<{
      entities: Record<string, string[]>; keywords: string[]; keyphrases: string[];
      available: boolean; engine?: string; reason?: string;
    }>(`/cases/${id}/entities`),
    enabled: !!id,
    staleTime: Infinity,
  });

export const useEval = () => useQuery({ queryKey: ['eval'], queryFn: () => api.get<any>('/eval') });

export const useCases = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['cases', role(), params], queryFn: () => api.get<Paged<CaseRow>>(`/cases${qs(params)}`) });
export const useCase = (id?: string) =>
  useQuery({ queryKey: ['case', id], queryFn: () => api.get<CaseDetailResult>(`/cases/${id}`), enabled: !!id });

export const useGraphCase = (id?: string) =>
  useQuery({ queryKey: ['graph', role(), 'case', id], queryFn: () => api.get<GraphData>(`/graph/case/${id}?explain=true`), enabled: !!id });
export const useGraphCluster = (id?: string) =>
  useQuery({ queryKey: ['graph', role(), 'cluster', id], queryFn: () => api.get<GraphData & { cluster: any }>(`/graph/cluster/${id}`), enabled: !!id });

export const useOffenders = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['offenders', role(), params], queryFn: () => api.get<Paged<Offender>>(`/offenders${qs(params)}`) });
export const useOffender = (id?: string) =>
  useQuery({ queryKey: ['offender', role(), id], queryFn: () => api.get<Offender>(`/offenders/${id}`), enabled: !!id });

export const useHealthCases = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['health', role(), params], queryFn: () => api.get<Paged<HealthRow>>(`/health/cases${qs(params)}`) });
export const useHealthSummary = () =>
  useQuery({ queryKey: ['healthSummary', role()], queryFn: () => api.get<any>('/health/summary') });
export const useDeadlines = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['deadlines', role(), params], queryFn: () => api.get<any>(`/analytics/deadlines${qs(params)}`) });
export const useTasking = () =>
  useQuery({ queryKey: ['tasking', role()], queryFn: () => api.get<any>('/analytics/tasking') });
export const useMix = () =>
  useQuery({ queryKey: ['mix', role()], queryFn: () => api.get<any>('/analytics/mix') });
export const useNearRepeat = () =>
  useQuery({ queryKey: ['nearRepeat', role()], queryFn: () => api.get<any>('/analytics/near-repeat') });
export const useReporting = () =>
  useQuery({ queryKey: ['reporting', role()], queryFn: () => api.get<any>('/analytics/reporting') });
export const useScopeProfile = () =>
  useQuery({ queryKey: ['scopeProfile', role()], queryFn: () => api.get<any>('/analytics/profile') });
export const useConcentration = () =>
  useQuery({ queryKey: ['concentration', role()], queryFn: () => api.get<any>('/analytics/concentration') });

export const useGeoPoints = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['geo', role(), params], queryFn: () => api.get<any>(`/geo/points${qs(params)}`) });
// role() carries the drilled district, and these two were the hooks missing it -- without
// it a drilled-in officer would be served the previous scope's clusters from cache.
export const useHotspots = (emerging?: boolean) =>
  useQuery({
    queryKey: ['hotspots', role(), emerging],
    queryFn: () => api.get<{
      hotspots: Hotspot[];
      districtCounts: Record<string, number>;
      scope?: 'state' | 'district';
      spatiotemporal?: Hotspot[];
    }>(`/geo/hotspots${qs({ emerging })}`),
  });
export const useGeoGrid = (params: Record<string, unknown>, enabled = true) =>
  useQuery({ queryKey: ['geo-grid', role(), params], queryFn: () => api.get<any>(`/geo/grid${qs(params)}`), enabled });
export const useDistricts = () =>
  useQuery({ queryKey: ['districts-geo'], queryFn: () => api.get<any>('/geo/districts'), staleTime: Infinity });
export const useFeaturedNetworks = () =>
  useQuery({ queryKey: ['graph-featured', role()], queryFn: () => api.get<any>('/graph/featured'), staleTime: Infinity });
export const useCommand = (explain = true) =>
  useQuery({ queryKey: ['command', role(), explain], queryFn: () => api.get<any>(`/command${qs({ explain })}`), staleTime: 120000 });

export const useZones = (explain = true) =>
  useQuery({ queryKey: ['zones', role(), role(), explain], queryFn: () => api.get<any>(`/zones${qs({ explain })}`), staleTime: 300000 });
export const useOccasions = (explain = true) =>
  useQuery({ queryKey: ['occasions', role(), explain], queryFn: () => api.get<any>(`/analytics/occasions${qs({ explain })}`), staleTime: Infinity });

export const useSocio = () =>
  useQuery({ queryKey: ['socio', role()], queryFn: () => api.get<any>('/analytics/socio'), staleTime: Infinity });
export const useForecast = () =>
  useQuery({ queryKey: ['forecast', role()], queryFn: () => api.get<any>('/analytics/forecast?explain=true'), staleTime: Infinity });
export const useNational = () =>
  useQuery({ queryKey: ['national'], queryFn: () => api.get<any>('/geo/national'), staleTime: Infinity });
export const useVulnerability = (enabled: boolean) =>
  useQuery({ queryKey: ['vulnerability', role()], queryFn: () => api.get<any>('/analytics/vulnerability'), enabled });
// The audit view answers "what has been looked at recently", so it shows the most recent 100
// events and stops. The full trail is retained in the AuditLog table regardless of what this
// page renders -- capping the view is a display choice, not a retention one.
export const AUDIT_LIMIT = 100;
export const useAudit = (enabled: boolean, action?: string) =>
  useQuery({
    queryKey: ['audit', role(), action || 'all'],
    queryFn: () => api.get<{ items: any[]; source?: string }>(`/audit?limit=${AUDIT_LIMIT}${action ? `&action=${encodeURIComponent(action)}` : ''}`),
    enabled,
  });

export const useAssistant = () =>
  useMutation({
    mutationFn: (body: { text: string; lang: string; context?: Record<string, unknown> }) =>
      api.post<AssistantResponse>('/assistant/query', body),
  });
export const useExport = () =>
  useMutation({ mutationFn: (body: { title: string; messages: any[] }) => api.post<{ html: string; filename: string }>('/assistant/export', body) });

// Contextual intelligence. The query mirrors whatever the page is currently filtered to, so
// the analysis re-runs when the filter changes -- that is the whole point of it.
export type Signal = {
  key: string; severity: 'high' | 'medium' | 'info'; title: string; detail: string;
  query: Record<string, string> | null; queryLabel: string | null;
};
export type Intel = {
  total: number; signals: Signal[]; facts: Record<string, unknown>;
  insight?: string; insightSource?: string; asOf?: string;
};
const intelQuery = (path: string, params: Record<string, unknown>) =>
  useQuery({
    queryKey: ['intel', path, role(), params],
    queryFn: () => api.get<Intel>(`${path}${qs(params)}`),
    staleTime: 5 * 60 * 1000,
  });
export const useCaseIntel = (params: Record<string, unknown>) => intelQuery('/cases/intelligence', params);
export const useOffenderIntel = (params: Record<string, unknown>) => intelQuery('/offenders/intelligence', params);
export const useHealthIntel = (params: Record<string, unknown>) => intelQuery('/health/intelligence', params);
export const useGeoIntel = (params: Record<string, unknown>) => intelQuery('/geo/intelligence', params);

// Zia narrative themes. Its own query on purpose: an external call that takes seconds must
// not hold the intelligence panel behind it, so the deterministic signals paint first and
// this row appears when it resolves.
export const useCaseThemes = (params: Record<string, unknown>) =>
  useQuery({
    queryKey: ['case-themes', role(), params],
    queryFn: () => api.get<{
      themes: { phrase: string; documents: number }[];
      sampled?: number; available: boolean; reason?: string; engine?: string;
    }>(`/cases/themes${qs(params)}`),
    staleTime: 10 * 60 * 1000,
  });

// Access requests. Only the DGP and the Administrator can read or decide these; the server
// refuses everyone else, so the hook is enabled on the capability rather than the role name.
export type AccessRequest = {
  id: string; email: string; fullName: string; role: string;
  districtId: string | null; unitId: string | null; status: string;
  requestedAt?: string; approvedBy?: string | null; decidedAt?: string | null;
};
export const useAccessRequests = (enabled: boolean, status = 'pending') =>
  useQuery({
    queryKey: ['access-requests', role(), status],
    queryFn: () => api.get<{ items: AccessRequest[]; available: boolean; reason?: string }>(
      `/auth/requests${qs({ status })}`),
    enabled,
  });
export const useDecideRequest = () =>
  useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject' }) =>
      api.post<{ ok: boolean; status: string }>(`/auth/requests/${v.id}/decide`, { decision: v.decision }),
  });

// Forecast and React surfaces. Both scope-aware, so they carry role() in the key.
export const useOutlook = (params: Record<string, unknown> = {}) =>
  useQuery({
    queryKey: ['outlook', role(), params],
    queryFn: () => api.get<any>(`/analytics/outlook${qs(params)}`),
    staleTime: 5 * 60 * 1000,
  });
export const useWorklist = (params: Record<string, unknown> = {}) =>
  useQuery({
    queryKey: ['worklist', role(), params],
    queryFn: () => api.get<any>(`/analytics/worklist${qs(params)}`),
    staleTime: 2 * 60 * 1000,
  });

// The agenda behind React. `unit` is passed explicitly rather than picked up by the client
// the way `district` is, because drilling into one station is a deliberate act on this page
// and not an ambient scope the rest of the product should inherit.
// The offender-risk model's ranking. Kept separate from useOutlook so a slow model call can
// never delay the statistical panels, which have nothing to do with it.
// The model is a slug now, not a horizon, because the family stopped being one question asked
// at four distances: "surfaces in a district they have never worked" and "returns with a crime
// against women" are different questions about the same people, and their shortlists share
// almost nobody.
export const useOffenderRisk = (model = 'h180') =>
  useQuery({
    queryKey: ['offender-risk', role(), model],
    queryFn: () => api.get<any>(`/analytics/offender-risk?model=${encodeURIComponent(model)}`),
    staleTime: 5 * 60 * 1000,
  });
// The pendency model scores registers, not people, so it needs no model picker -- one question,
// one endpoint.
export const usePendencyRisk = () =>
  useQuery({
    queryKey: ['pendency-risk', role()],
    queryFn: () => api.get<any>('/analytics/pendency-risk'),
    staleTime: 5 * 60 * 1000,
  });
export const useAgenda = (params: Record<string, unknown> = {}) =>
  useQuery({
    queryKey: ['agenda', role(), params],
    queryFn: () => api.get<any>(`/analytics/agenda${qs(params)}`),
    staleTime: 2 * 60 * 1000,
  });

// ---- the write path ---------------------------------------------------------------------
// Submissions and lifecycle updates. Every mutation invalidates the register as well as the
// queue, because approving a case changes what /cases returns -- and a queue that empties
// while the register behind it still shows yesterday's rows is how people stop trusting both.
export type Submission = {
  id: string; crimeNo: string; caseNo: string | null;
  unitId: string; districtId: string;
  crimeHeadId: string; crimeSubHeadId: string;
  gravityId: string | null; categoryId: string | null;
  crimeRegisteredDate: string; incidentFromDate: string | null;
  latitude: string | null; longitude: string | null;
  briefFacts: string; actsSections: string; ioName: string;
  submittedBy: string; submitterRole: string; submittedAt: string;
  status: 'pending' | 'approved' | 'rejected' | 'returned';
  reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null;
  caseMasterId: string | null;
  parties?: { id: string; partyRole: string; fullName: string; age: string | null; gender: string | null; address: string; contact: string }[];
  canDecide?: boolean;
};
export type SubmissionList = {
  items: Submission[]; visible: boolean; available?: boolean; reason?: string;
  canSubmit: boolean; canApprove: boolean; approvalScope: 'state' | 'district' | null;
};

export const useSubmissions = (status = '', enabled = true) =>
  useQuery({
    queryKey: ['submissions', role(), status],
    queryFn: () => api.get<SubmissionList>(`/submissions${qs({ status })}`),
    enabled,
    staleTime: 30 * 1000,
  });
export const useSubmission = (id?: string) =>
  useQuery({
    queryKey: ['submission', role(), id],
    queryFn: () => api.get<Submission>(`/submissions/${id}`),
    enabled: !!id,
  });
export const useSubmitCase = () =>
  useMutation({ mutationFn: (body: Record<string, unknown>) => api.post<{ ok: boolean; id: string; crimeNo: string }>('/submissions', body) });
export const useDecideSubmission = () =>
  useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject' | 'return'; note?: string }) =>
      api.post<{ ok: boolean; status: string; caseMasterId: string | null }>(
        `/submissions/${v.id}/decide`, { decision: v.decision, note: v.note || '' }),
  });

export type CaseUpdateRow = {
  id: string; caseMasterId: string; crimeNo: string | null;
  districtId: string; unitId: string;
  updateType: string; updateLabel: string; field: string;
  beforeValue: string; afterValue: string; reason: string;
  requestedBy: string; requesterRole: string; requestedAt: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null;
};
export const useCaseUpdates = (params: { status?: string; case?: string } = {}, enabled = true) =>
  useQuery({
    queryKey: ['case-updates', role(), params],
    queryFn: () => api.get<{
      items: CaseUpdateRow[]; visible: boolean; available?: boolean; reason?: string;
      canApprove: boolean; types: Record<string, { label: string; field: string }>;
    }>(`/case-updates${qs(params)}`),
    enabled,
    staleTime: 30 * 1000,
  });
export const useRequestUpdate = () =>
  useMutation({ mutationFn: (body: Record<string, unknown>) => api.post<{ ok: boolean; id: string }>('/case-updates', body) });
export const useDecideUpdate = () =>
  useMutation({
    mutationFn: (v: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      api.post<{ ok: boolean; status: string }>(`/case-updates/${v.id}/decide`, { decision: v.decision, note: v.note || '' }),
  });

// ---- evidence readings filed against a case ----------------------------------------------
// Writing one needs state tier (it needs the ability to read an uploaded image at all).
// Reading them back follows the CASE, so the station that registered it sees the memo
// transcription without ever being able to upload an image.
export type EvidenceNoteRow = {
  id: string; caseMasterId: string; crimeNo: string | null;
  capability: 'ocr' | 'barcode' | 'read'; capabilityLabel: string; engine: string;
  question: string; extract: string; confidence: string | null;
  filename: string | null; bytes: number | null;
  status: 'filed' | 'withdrawn';
  pages: number;
  // Whether the page image behind this reading was kept. The file id itself never reaches the
  // browser -- a handle in a list response is a handle somebody can try.
  retained: boolean; retainedBy: string | null; rereads: number;
  createdBy: string; creatorRole: string; createdAt: string;
  withdrawnBy: string | null; withdrawnAt: string | null; withdrawReason: string | null;
};
export const useCaseEvidence = (caseId: string, enabled = true) =>
  useQuery({
    queryKey: ['case-evidence', role(), caseId],
    queryFn: () => api.get<{
      items: EvidenceNoteRow[]; caseMasterId: string; canFile: boolean;
      // False when the case is outside this officer's own scope. The register's DETAIL view
      // is open to any account (its scope check was never implemented), but a transcription
      // of a photographed document must not travel further than the case does.
      visible?: boolean; reason?: string;
    }>(
      `/cases/${encodeURIComponent(caseId)}/evidence`),
    enabled: enabled && Boolean(caseId),
    staleTime: 30 * 1000,
  });
export const useMyEvidenceNotes = (enabled = true) =>
  useQuery({
    queryKey: ['evidence-notes', role()],
    queryFn: () => api.get<{ items: EvidenceNoteRow[]; mine: boolean }>('/evidence/notes?limit=12'),
    enabled,
    staleTime: 15 * 1000,
  });
export const useFileEvidenceNote = () =>
  useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post<{ ok: boolean; id: string; caseMasterId: string; crimeNo: string | null }>('/evidence/note', body),
  });
export const useRereadEvidencePage = () =>
  useMutation({
    mutationFn: (v: { id: string; capability: 'ocr' | 'barcode' | 'read'; question?: string }) =>
      api.post<{
        ok: boolean; text?: string; engine?: string; confidence?: string | null;
        ms?: number; rereads?: number; refused?: boolean; answer?: string; detail?: string;
      }>(`/evidence/note/${v.id}/reread`, { capability: v.capability, question: v.question || '' }),
  });
export const useWithdrawEvidenceNote = () =>
  useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      api.post<{ ok: boolean; id: string }>(`/evidence/note/${v.id}/withdraw`, { reason: v.reason }),
  });

// ---- translation ------------------------------------------------------------------------
// Zia does not translate on this project (a live probe returns vision and text analytics and
// nothing linguistic), so this runs on the QuickML LLM server-side, batched and cached, with
// FIR numbers and ids masked out so they survive byte for byte.
export const useTranslate = () =>
  useMutation({
    mutationFn: (v: { texts: string[]; to?: string }) =>
      api.post<{
        items: { source: string; text: string; translated: boolean }[];
        engine: string; translated: number; total: number;
      }>('/translate', { texts: v.texts, to: v.to || 'kn' }),
  });

// The voices the deployed TTS endpoint actually has. Fetched rather than hard-coded: the
// console's model card lists an English speaker the endpoint refuses, so a list compiled from
// the documentation would be wrong on first use.
export const useServerVoices = () =>
  useQuery({ queryKey: ['tts-voices'], queryFn: () => api.get<any>('/tts/voices'), staleTime: Infinity });
