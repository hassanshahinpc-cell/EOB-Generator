export enum PayerType {
  MedicareAdvantage = 'Medicare Advantage',
  Commercial = 'Commercial',
  Medicaid = 'Medicaid',
  Other = 'Other'
}

export enum AdjustmentGroupCode {
  CO = 'CO',
  PR = 'PR',
  OA = 'OA'
}

export interface Adjustment {
  groupCode: AdjustmentGroupCode;
  carc: string;
  description?: string;
  amount: number;
  rarc?: string;
}

export interface ServiceLine {
  id: string;
  dateOfService: string;
  cpt: string;
  modifiers: string;
  diagPointers: string;
  units: number;
  billedAmount: number;
  allowedAmount: number;
  paidAmount: number;
  patientResponsibility: {
    deductible: number;
    coinsurance: number;
    copay: number;
  };
  adjustments: Adjustment[];
}

export interface EOBData {
  denialReason: string;
  suggestedCodes: {
    groupCode: AdjustmentGroupCode;
    carc: string;
    rarc?: string;
  };
  useSuggested: boolean;
  
  patient: {
    fullName: string;
    dob: string;
    memberId: string;
  };
  claim: {
    claimNumber: string;
    dosStart: string;
    dosEnd: string;
  };
  providers: {
    renderingName: string;
    renderingNpi: string;
    billingName: string;
    billingNpi: string;
    taxId: string;
    billingAddress?: string;
  };
  insurance: {
    payerName: string;
    payerType: PayerType;
    policyNumber: string;
    groupNumber?: string;
    payerAddress?: string;
  };
  claimTotals: {
    billedAmount: number;
    allowedAmount: number;
    paidAmount: number;
    patientResponsibility: number;
    paymentDate: string;
    checkNumber: string;
    checkDetails?: string;
  };
  serviceLines: ServiceLine[];
  remarks: string;
}

export type Step = 
  | 'DENIAL' 
  | 'PATIENT_CLAIM' 
  | 'INSURANCE' 
  | 'CLAIM_TOTALS' 
  | 'SERVICE_LINES' 
  | 'REMARKS' 
  | 'VALIDATION' 
  | 'OUTPUT' 
  | 'EXPORT';
