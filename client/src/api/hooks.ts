// React Query hooks over the KADI API.
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, qs, getRole, districtParam } from '../lib/api';
import type {
  Me, CaseRow, CaseDetail, Paged, GraphData, Offender, HealthRow, Stats, Alert,
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
  useQuery({ queryKey: ['case', id], queryFn: () => api.get<CaseDetail>(`/cases/${id}`), enabled: !!id });

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
  useMutation({ mutationFn: (body: { text: string; lang: string }) => api.post<AssistantResponse>('/assistant/query', body) });
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
