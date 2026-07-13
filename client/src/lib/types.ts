// Shared API types (mirror the Node API response shapes).
export interface Me {
  user: { appUserId: string; name: string; role: string; unitId: string | null; districtId: string | null };
  capabilities: { role: string; label: string; scope: string; canViewVulnerability: boolean; canViewAudit: boolean; canAdmin: boolean };
  fairness: string;
  roles: string[];
}

export interface CaseRow {
  caseMasterId: string; crimeNo: string; caseNo: string;
  crimeRegisteredDate: string; incidentFromDate: string; infoReceivedPSDate: string;
  unitId: string; unitName: string; districtId: string; districtName: string;
  crimeHeadId: string; crimeHead: string; crimeSubHeadId: string; crimeSubHead: string;
  statusId: string; status: string; categoryId: string; category: string;
  gravityId: string; gravity: string;
  latitude: number | null; longitude: number | null; briefFacts: string;
  ioId: string; ioName: string; linkedCount: number;
  healthSeverity: string | null; healthFlags: string[]; clusterId: string | null;
}

export interface CaseDetail extends CaseRow {
  parties: {
    complainants: { name: string; age: string; genderId: string }[];
    victims: { name: string; age: string; genderId: string; isPolice: boolean }[];
    accused: { accusedMasterId: string; name: string; age: string; genderId: string; personId: string }[];
  };
  acts: { act: string; section: string; description: string }[];
  arrests: { date: string; typeId: string; districtId: string; accusedMasterId: string }[];
  chargesheets: { date: string; type: string; typeLabel: string }[];
  health: HealthRow | null;
  offenders: { offenderIdentityId: string; canonicalName: string; riskScore: number; band: string }[];
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; fairness?: string }

export interface GraphNode {
  id: string; type: 'case' | 'offender'; label: string;
  caseId?: string; offenderId?: string; crimeHead?: string; crimeSubHead?: string;
  district?: string; unit?: string; status?: string; gravity?: string; date?: string;
  clusterId?: string | null; isCenter?: boolean; riskScore?: number; band?: string; cases?: number;
}
export interface EvidenceItem { type: string; detail: string; offenderIds?: string[] }
export interface GraphEdge {
  id: string; source: string; target: string; edgeType: string; allTypes?: string[];
  strength: number; clusterId?: string | null;
  explanation: { sourceFIRs?: string[]; matched: EvidenceItem[] };
}
export interface GraphData {
  center: string; clusterId: string | null; nodes: GraphNode[]; edges: GraphEdge[];
  explanation: { summary: string; edgeTypes: string[]; fairness: string };
}

export interface RiskFactor { factor: string; label: string; value: number; contribution: number }
export interface Offender {
  offenderIdentityId: string; canonicalName: string; caseIds: string[];
  distinctCases: number; distinctDistricts: number; districts: string[];
  confidence: number; lowConfidence: boolean; nameVariants: string[];
  riskScore: number; band: string; factors: RiskFactor[]; protectedAttributesUsed: number;
  coOffenders: { offenderIdentityId: string; canonicalName: string; sharedCases: number }[];
  arrests: { date: string; districtId: string; unitId: string; typeId: string }[];
  arrestCount: number; firstSeen: string | null; lastSeen: string | null;
  clusterIds: string[]; linkedCaseCount: number;
  cases?: { caseMasterId: string; crimeNo: string; crimeSubHead: string; district: string; unit: string; status: string; date: string; gravity: string }[];
  fairness?: string;
}

export interface HealthRow {
  caseMasterId: string; crimeNo: string; unitId: string; districtId: string; subheadId: string;
  statusId: string; reportingDelayHrs: number | null; investigationAgeDays: number;
  peerMedianAgeDays: number; undetectedRiskScore: number; falseCasePatternFlag: boolean;
  flags: { flag: string; reason: string }[]; flagKeys: string[]; severity: string;
  clusterId: string | null; recommendationText: string;
  crimeSubHead?: string; district?: string; unit?: string; ioName?: string; gravity?: string;
}

export interface Stats {
  totalCases: number; openCases: number; chargeSheeted: number; undetected: number;
  flaggedCases: number; seriousFlaggedCases: number; activeNetworks: number;
  crossDistrictNetworks: number; resolvedOffenders: number; highRiskOffenders: number;
  emergingHotspots: number; caseAnomalies: number;
  topCrimeHeads: { headId: string; name: string; count: number }[];
  trend: { month: string; count: number }[];
}

export interface Alert {
  alertId: string; kind: string; severity: string; title: string; reason: string;
  ts: string; acknowledged: boolean; caseMasterId?: string; offenderIdentityId?: string;
  clusterId?: string; unitId?: string; districtId?: string; cellId?: string;
}

export interface Hotspot {
  cellId: string; crimeHeadId: string; crimeSubHeadId: string; centroidLat: number; centroidLng: number;
  count: number; recentCount: number; baselineExpected: number; emergingFlag: boolean; caseIds: string[];
}

export interface AssistantResponse {
  intent: string; lang: string; answer: string;
  citations: { type: string; id: string; label: string }[];
  action: { type: string; [k: string]: any } | null;
  fairness: string; grounded: boolean; ttsText?: string;
}

export interface Lookups {
  heads: { id: string; name: string }[];
  subheads: { id: string; name: string; headId: string }[];
  statuses: { id: string; name: string }[];
  gravities: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  districts: { id: string; name: string }[];
}
