// React Query hooks over the KADI API.
import { useQuery, useMutation } from '@tanstack/react-query';
import { api, qs, getRole, districtParam } from '../lib/api';
import type {
  Me, CaseRow, CaseDetail, Paged, GraphData, Offender, HealthRow, Stats, Alert,
  Hotspot, AssistantResponse, Lookups,
} from '../lib/types';

// Role AND drilled district both go in every query key. Without the district, drilling into
// Kalaburagi would serve Bengaluru's cached rows back.
const role = () => `${getRole()}:${districtParam() || 'state'}`;

export const useMe = () => useQuery({ queryKey: ['me', role()], queryFn: () => api.get<Me>('/me') });
export const useLookups = () => useQuery({ queryKey: ['lookups'], queryFn: () => api.get<Lookups>('/lookups'), staleTime: Infinity });
export const useStats = () => useQuery({ queryKey: ['stats', role()], queryFn: () => api.get<Stats>('/stats') });
export const useAlerts = () => useQuery({ queryKey: ['alerts', role()], queryFn: () => api.get<Alert[]>('/alerts') });
export const useEval = () => useQuery({ queryKey: ['eval'], queryFn: () => api.get<any>('/eval') });

export const useCases = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['cases', role(), params], queryFn: () => api.get<Paged<CaseRow>>(`/cases${qs(params)}`) });
export const useCase = (id?: string) =>
  useQuery({ queryKey: ['case', id], queryFn: () => api.get<CaseDetail>(`/cases/${id}`), enabled: !!id });

export const useGraphCase = (id?: string) =>
  useQuery({ queryKey: ['graph', 'case', id], queryFn: () => api.get<GraphData>(`/graph/case/${id}`), enabled: !!id });
export const useGraphCluster = (id?: string) =>
  useQuery({ queryKey: ['graph', 'cluster', id], queryFn: () => api.get<GraphData & { cluster: any }>(`/graph/cluster/${id}`), enabled: !!id });

export const useOffenders = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['offenders', params], queryFn: () => api.get<Paged<Offender>>(`/offenders${qs(params)}`) });
export const useOffender = (id?: string) =>
  useQuery({ queryKey: ['offender', id], queryFn: () => api.get<Offender>(`/offenders/${id}`), enabled: !!id });

export const useHealthCases = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['health', role(), params], queryFn: () => api.get<Paged<HealthRow>>(`/health/cases${qs(params)}`) });
export const useHealthSummary = () =>
  useQuery({ queryKey: ['healthSummary', role()], queryFn: () => api.get<any>('/health/summary') });

export const useGeoPoints = (params: Record<string, unknown>) =>
  useQuery({ queryKey: ['geo', role(), params], queryFn: () => api.get<any>(`/geo/points${qs(params)}`) });
export const useHotspots = (emerging?: boolean) =>
  useQuery({ queryKey: ['hotspots', emerging], queryFn: () => api.get<{ hotspots: Hotspot[]; districtCounts: Record<string, number> }>(`/geo/hotspots${qs({ emerging })}`) });
export const useGeoGrid = (params: Record<string, unknown>, enabled = true) =>
  useQuery({ queryKey: ['geo-grid', params], queryFn: () => api.get<any>(`/geo/grid${qs(params)}`), enabled });
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
  useQuery({ queryKey: ['socio'], queryFn: () => api.get<any>('/analytics/socio'), staleTime: Infinity });
export const useForecast = () =>
  useQuery({ queryKey: ['forecast'], queryFn: () => api.get<any>('/analytics/forecast'), staleTime: Infinity });
export const useNational = () =>
  useQuery({ queryKey: ['national'], queryFn: () => api.get<any>('/geo/national'), staleTime: Infinity });
export const useVulnerability = (enabled: boolean) =>
  useQuery({ queryKey: ['vulnerability'], queryFn: () => api.get<any>('/analytics/vulnerability'), enabled });
export const useAudit = (enabled: boolean) =>
  useQuery({ queryKey: ['audit', role()], queryFn: () => api.get<{ items: any[] }>('/audit?limit=200'), enabled });

export const useAssistant = () =>
  useMutation({ mutationFn: (body: { text: string; lang: string }) => api.post<AssistantResponse>('/assistant/query', body) });
export const useExport = () =>
  useMutation({ mutationFn: (body: { title: string; messages: any[] }) => api.post<{ html: string; filename: string }>('/assistant/export', body) });
