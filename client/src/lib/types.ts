// Shared API types (mirror the Node API response shapes).
export interface Me {
  user: { appUserId: string; name: string; role: string; unitId: string | null; districtId: string | null };
  capabilities: {
    role: string; label: string; scope: string;
    // Three tiers, and the drill state on top of them. effectiveScope is what the server is
    // actually applying right now -- a state user drilled into a district reads 'district',
    // and a station officer always reads 'unit'.
    tier: 'state' | 'district' | 'station';
    effectiveScope: 'state' | 'district' | 'unit';
    isStation?: boolean;
    // Present only at station tier: the one register this user holds.
    unitName?: string | null;
    districtName?: string | null;
    districtId: string | null;
    drillUnitId: string | null;
    drilledFromState: boolean;
    canSwitchDistrict: boolean;
    canViewWholeState: boolean;
    canViewVulnerability: boolean; canViewAudit: boolean; canAdmin: boolean;
    // Sign-up requests are decided by the two posts that hold the whole state.
    canApproveAccounts?: boolean;
    // The write path. A station registers a case; a supervisor lets it stand.
    canSubmitCase?: boolean;
    canApproveCases?: boolean;
    // True only for a token-backed session, so the shell can tell a real sign-in from the demo.
    authenticated?: boolean;
    email?: string | null;
  };
  fairness: string;
  roles: string[];
}

export interface CaseRow {
  // Set on a case approved since the last pipeline run: it is in the register, but nothing
  // has looked for links or scored it yet. The interface must say so rather than let a reader
  // conclude from linkedCount: 0 that the case is unconnected.
  awaitingAnalysis?: boolean;
  source?: string;
  caseMasterId: string; crimeNo: string; caseNo: string;
  crimeRegisteredDate: string; incidentFromDate: string; infoReceivedPSDate: string;
  unitId: string; unitName: string; districtId: string; districtName: string;
  crimeHeadId: string; crimeHead: string; crimeSubHeadId: string; crimeSubHead: string;
  statusId: string; status: string; categoryId: string; category: string;
  gravityId: string; gravity: string;
  latitude: number | null; longitude: number | null; briefFacts: string;
  ioId: string; ioName: string; ioRank: string; ioDesignation: string;
  courtId: string; courtName: string; linkedCount: number;
  healthSeverity: string | null; healthFlags: string[]; clusterId: string | null;
}

export interface CaseDetail extends CaseRow {
  parties: {
    complainants: { name: string; age: string; genderId: string }[];
    victims: { name: string; age: string; genderId: string; isPolice: boolean }[];
    accused: { accusedMasterId: string; name: string; age: string; genderId: string; personId: string }[];
  };
  acts: { act: string; section: string; description: string }[];
  arrests: {
    date: string; typeId: string; typeLabel: string;
    districtId: string; districtName: string;
    accusedMasterId: string; accusedName: string;
    isAccused: boolean; isComplainantAccused: boolean;
  }[];
  chargesheets: { date: string; type: string; typeLabel: string }[];
  health: HealthRow | null;
  offenders: { offenderIdentityId: string; canonicalName: string; riskScore: number; band: string }[];
}

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number; fairness?: string   // offender list, district scope: how the list splits by where they are based
  scope?: 'state' | 'district';
  reachingIn?: number | null;
  basedHere?: number | null;
  sort?: string;
  // Counts over the whole filtered set, not just the returned page.
  summary?: Record<string, number>;
  // Offender list: the corpus's own latest offending date, which "recently active" is measured against.
  asOf?: string | null;
}

export interface GraphNode {
  id: string; type: 'case' | 'offender'; label: string;
  caseId?: string; offenderId?: string; crimeHead?: string; crimeSubHead?: string;
  district?: string; unit?: string; status?: string; gravity?: string; date?: string;
  clusterId?: string | null; isCenter?: boolean; riskScore?: number; band?: string; cases?: number;
  outsideScope?: boolean; latitude?: number | null; longitude?: number | null;
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
  insight?: string; insightSource?: string;
}

export interface RiskFactor { factor: string; label: string; value: number; contribution: number }
export interface Offender {
  offenderIdentityId: string; canonicalName: string; caseIds: string[];
  distinctCases: number; distinctDistricts: number; districts: string[];
  confidence: number; lowConfidence: boolean; nameVariants: string[];
  riskScore: number; band: string; factors: RiskFactor[]; protectedAttributesUsed: number;
  coOffenders: { offenderIdentityId: string; canonicalName: string; sharedCases: number }[];
  // District scope only: whether this person works solely here, or is based elsewhere and
  // reaches in. The second group is the reason a district needs a state-linked system.
  basedHere?: boolean;
  reachesIn?: boolean;
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
  // /stats returns these whenever the viewer is scoped to (or drilled into) a district.
  scope?: 'state' | 'district';
  districtName?: string;
  totalCases: number; openCases: number; chargeSheeted: number; undetected: number;
  flaggedCases: number; seriousFlaggedCases: number; activeNetworks: number;
  crossDistrictNetworks: number; resolvedOffenders: number; highRiskOffenders: number;
  emergingHotspots: number; caseAnomalies: number;
  topCrimeHeads: { headId: string; name: string; count: number }[];
  trend: { month: string; count: number }[];
  heat: { dow: number; hour: number; count: number }[];
  statusBreakdown: { open: number; chargeSheeted: number; closed: number; undetected: number };
  gravitySplit: { heinous: number; nonHeinous: number };
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
