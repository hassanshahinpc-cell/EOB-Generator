import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function validateNPI(npi: string): boolean {
  return /^\d{10}$/.test(npi);
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

export function formatUSDate(dateStr: string): string {
  if (!dateStr || !dateStr.includes('-')) return dateStr;
  const [year, month, day] = dateStr.split('-');
  return `${month}/${day}/${year}`;
}

export const CARC_SUGGESTIONS: Record<string, { groupCode: 'CO' | 'PR' | 'OA', carc: string, rarc?: string }> = {
  'cob': { groupCode: 'CO', carc: '22', rarc: 'N24' },
  'coordination of benefits': { groupCode: 'CO', carc: '22', rarc: 'N24' },
  'missing eob': { groupCode: 'CO', carc: '236' },
  'contractual': { groupCode: 'CO', carc: '45' },
  'deductible': { groupCode: 'PR', carc: '1' },
  'coinsurance': { groupCode: 'PR', carc: '2' },
  'copay': { groupCode: 'PR', carc: '3' },
  'duplicate': { groupCode: 'CO', carc: '18' },
  'not covered': { groupCode: 'CO', carc: '96' },
  'medical necessity': { groupCode: 'CO', carc: '50' },
};

export function getSuggestedCodes(reason: string) {
  const normalized = reason.toLowerCase();
  for (const [key, value] of Object.entries(CARC_SUGGESTIONS)) {
    if (normalized.includes(key)) return value;
  }
  return { groupCode: 'OA' as const, carc: '96' }; // Default
}

export const CARC_DESCRIPTIONS: Record<string, string> = {
  '1': 'Deductible Amount',
  '2': 'Coinsurance Amount',
  '3': 'Copayment Amount',
  '18': 'Exact duplicate claim/service',
  '22': 'This care may be covered by another payer per coordination of benefits',
  '45': 'Charge exceeds fee schedule/maximum allowable or contracted/legislated fee arrangement',
  '50': 'These are non-covered services because this is not deemed a "medical necessity" by the payer',
  '96': 'Non-covered charge(s)',
  '119': 'Benefit maximum for this time period or occurrence has been reached',
  '236': 'This procedure or procedure/modifier combination is not compatible with another procedure or procedure/modifier combination provided on the same day according to the National Correct Coding Initiative or common billing conventions',
  '16': 'Claim/service lacks information or has submission/billing error(s) which is needed for adjudication.',
  '27': 'Expenses incurred after coverage terminated.',
  '29': 'The time limit for filing has expired.',
  '31': 'Patient cannot be identified as our insured.',
  '197': 'Precertification/authorization/notification absent.',
};

export const RARC_DESCRIPTIONS: Record<string, string> = {
  'N24': 'Missing/incomplete/invalid Electronic Explanation of Benefits (EEOB) from the primary payer',
  'N1': 'Alert: You may appeal this decision in writing',
  'MA01': 'If you do not agree with this determination, you have the right to appeal',
  'M15': 'Separately billed services/tests have been bundled as they are considered components of the same procedure',
  'N30': 'Patient ineligible on this date of service.',
  'N211': 'Alert: You may not appeal this decision.',
};

export function getCarcDescription(code: string): string {
  return CARC_DESCRIPTIONS[code] || 'Description not found for this code';
}

export function getRarcDescription(code: string): string {
  return RARC_DESCRIPTIONS[code] || 'Description not found for this code';
}
