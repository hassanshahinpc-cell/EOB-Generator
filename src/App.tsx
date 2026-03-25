/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  FileText, 
  User, 
  Shield, 
  DollarSign, 
  List, 
  CheckCircle2, 
  Download, 
  Plus, 
  Trash2, 
  AlertCircle,
  ChevronRight,
  ChevronLeft,
  Printer,
  FileJson,
  Undo2,
  Redo2,
  Save,
  RotateCcw,
  ClipboardPaste
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { 
  EOBData, 
  Step, 
  PayerType, 
  AdjustmentGroupCode, 
  ServiceLine, 
  Adjustment 
} from './types';
import { 
  cn, 
  validateNPI, 
  formatCurrency, 
  formatUSDate,
  getSuggestedCodes,
  getCarcDescription,
  getRarcDescription
} from './utils';

const formatDosRange = (start: string, end: string) => {
  if (!start) return 'N/A';
  const formattedStart = formatUSDate(start);
  const formattedEnd = formatUSDate(end);
  if (!end || start === end) return formattedStart;
  return `${formattedStart} - ${formattedEnd}`;
};

const STEPS: { id: Step; label: string; icon: React.ElementType }[] = [
  { id: 'DENIAL', label: 'Denial Reason', icon: AlertCircle },
  { id: 'PATIENT_CLAIM', label: 'Patient & Claim', icon: User },
  { id: 'INSURANCE', label: 'Insurance', icon: Shield },
  { id: 'CLAIM_TOTALS', label: 'Claim Totals', icon: DollarSign },
  { id: 'SERVICE_LINES', label: 'Service Lines', icon: List },
  { id: 'REMARKS', label: 'Remarks', icon: FileText },
  { id: 'VALIDATION', label: 'Validation', icon: CheckCircle2 },
  { id: 'OUTPUT', label: 'EOB Preview', icon: FileText },
  { id: 'EXPORT', label: 'Export', icon: Download },
];

const INITIAL_DATA: EOBData = {
  denialReason: '',
  suggestedCodes: { groupCode: AdjustmentGroupCode.OA, carc: '96' },
  useSuggested: true,
  patient: { fullName: '', dob: '', memberId: '' },
  claim: { claimNumber: '', dosStart: '', dosEnd: '' },
  providers: { renderingName: '', renderingNpi: '', billingName: '', billingNpi: '', taxId: '', billingAddress: '' },
  insurance: { payerName: '', payerType: PayerType.Commercial, policyNumber: '', payerAddress: '' },
  claimTotals: { 
    billedAmount: 0, 
    allowedAmount: 0, 
    paidAmount: 0, 
    patientResponsibility: 0, 
    paymentDate: '', 
    checkNumber: '',
    checkDetails: ''
  },
  serviceLines: [],
  remarks: '',
};

export default function App() {
  const [currentStep, setCurrentStep] = useState<Step>('DENIAL');
  const [data, setData] = useState<EOBData>(INITIAL_DATA);
  const [errors, setErrors] = useState<string[]>([]);
  const [history, setHistory] = useState<EOBData[]>([]);
  const [redoStack, setRedoStack] = useState<EOBData[]>([]);
  const [showBulkPaste, setShowBulkPaste] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState('');

  // Undo/Redo Logic
  const updateData = useCallback((newData: EOBData | ((prev: EOBData) => EOBData), skipHistory = false) => {
    setData(prev => {
      const resolvedData = typeof newData === 'function' ? newData(prev) : newData;
      if (!skipHistory) {
        setHistory(h => [...h.slice(-19), prev]); // Keep last 20 states
        setRedoStack([]);
      }
      return resolvedData;
    });
  }, []);

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack(r => [...r, data]);
    setHistory(h => h.slice(0, -1));
    setData(prev);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory(h => [...h, data]);
    setRedoStack(r => r.slice(0, -1));
    setData(next);
  };

  // Save/Load Draft
  useEffect(() => {
    const saved = localStorage.getItem('eob_draft');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setData(parsed);
      } catch (e) {
        console.error('Failed to load draft', e);
      }
    }
  }, []);

  const saveDraft = () => {
    localStorage.setItem('eob_draft', JSON.stringify(data));
    alert('Draft saved locally!');
  };

  const resetForm = () => {
    if (confirm('Are you sure you want to reset the entire form? This cannot be undone.')) {
      setData(INITIAL_DATA);
      setHistory([]);
      setRedoStack([]);
      localStorage.removeItem('eob_draft');
      setCurrentStep('DENIAL');
    }
  };

  const handleBulkPaste = () => {
    try {
      const lines = bulkPasteText.trim().split('\n');
      const newServiceLines: ServiceLine[] = lines.map(line => {
        const parts = line.split(/[\t,]/); // Support TSV or CSV
        // Expected format: DOS, CPT, Units, Billed, Allowed, Paid, Deductible, Coinsurance, Copay
        return {
          id: crypto.randomUUID(),
          dateOfService: parts[0] || '',
          cpt: parts[1] || '',
          units: parseInt(parts[2]) || 1,
          billedAmount: parseFloat(parts[3]) || 0,
          allowedAmount: parseFloat(parts[4]) || 0,
          paidAmount: parseFloat(parts[5]) || 0,
          patientResponsibility: {
            deductible: parseFloat(parts[6]) || 0,
            coinsurance: parseFloat(parts[7]) || 0,
            copay: parseFloat(parts[8]) || 0,
          },
          adjustments: [],
          diagPointers: '1',
        };
      });

      updateData(prev => ({
        ...prev,
        serviceLines: [...prev.serviceLines, ...newServiceLines]
      }));
      setShowBulkPaste(false);
      setBulkPasteText('');
    } catch (e) {
      alert('Error parsing data. Please ensure it follows the format: DOS, CPT, Units, Billed, Allowed, Paid, Deductible, Coinsurance, Copay');
    }
  };

  const currentStepIndex = STEPS.findIndex(s => s.id === currentStep);

  const handleNext = () => {
    if (validateStep()) {
      const nextStep = STEPS[currentStepIndex + 1];
      if (nextStep) setCurrentStep(nextStep.id);
    }
  };

  const handleBack = () => {
    const prevStep = STEPS[currentStepIndex - 1];
    if (prevStep) setCurrentStep(prevStep.id);
  };

  const validateStep = (): boolean => {
    const newErrors: string[] = [];

    switch (currentStep) {
      case 'DENIAL':
        // Denial reason is now optional for paid claims
        break;
      case 'PATIENT_CLAIM':
        if (!data.patient.fullName) newErrors.push('Patient name is required');
        if (!data.patient.dob) newErrors.push('DOB is required');
        if (!data.claim.claimNumber) newErrors.push('Claim number is required');
        if (!data.claim.dosStart) newErrors.push('Claim DOS Start is required');
        if (!data.providers.renderingNpi || !validateNPI(data.providers.renderingNpi)) 
          newErrors.push('Valid 10-digit Rendering NPI is required');
        if (!data.providers.billingNpi || !validateNPI(data.providers.billingNpi)) 
          newErrors.push('Valid 10-digit Billing NPI is required');
        if (!data.providers.taxId) newErrors.push('Tax ID is required');
        break;
      case 'CLAIM_TOTALS':
        const { allowedAmount, paidAmount, patientResponsibility } = data.claimTotals;
        if (Math.abs(allowedAmount - (paidAmount + patientResponsibility)) > 0.01) {
          newErrors.push(`Financial Mismatch: Total Allowed (${allowedAmount}) must equal Paid (${paidAmount}) + Patient Responsibility (${patientResponsibility})`);
        }
        break;
      case 'SERVICE_LINES':
        if (data.serviceLines.length === 0) newErrors.push('At least one service line is required');
        data.serviceLines.forEach((line, idx) => {
          const adjTotal = line.adjustments.reduce((sum, a) => sum + a.amount, 0);
          if (Math.abs(line.billedAmount - (line.allowedAmount + adjTotal)) > 0.01) {
            newErrors.push(`Line ${idx + 1}: Billed (${line.billedAmount}) must equal Allowed (${line.allowedAmount}) + Adjustments (${adjTotal})`);
          }
          if (Math.abs(line.allowedAmount - (line.paidAmount + (line.patientResponsibility.deductible + line.patientResponsibility.coinsurance + line.patientResponsibility.copay))) > 0.01) {
            newErrors.push(`Line ${idx + 1}: Allowed (${line.allowedAmount}) must equal Paid + Patient Responsibility`);
          }
        });
        break;
    }

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const updateDenialReason = (reason: string) => {
    const suggested = getSuggestedCodes(reason);
    updateData(prev => ({
      ...prev,
      denialReason: reason,
      suggestedCodes: suggested
    }));
  };

  const addServiceLine = () => {
    const newLine: ServiceLine = {
      id: Math.random().toString(36).substr(2, 9),
      dateOfService: data.claim.dosStart || new Date().toISOString().split('T')[0],
      cpt: '',
      modifiers: '',
      diagPointers: '1',
      units: 1,
      billedAmount: 0,
      allowedAmount: 0,
      paidAmount: 0,
      patientResponsibility: { deductible: 0, coinsurance: 0, copay: 0 },
      adjustments: data.useSuggested ? [{
        groupCode: data.suggestedCodes.groupCode,
        carc: data.suggestedCodes.carc,
        amount: 0,
        rarc: data.suggestedCodes.rarc
      }] : []
    };
    updateData(prev => ({ ...prev, serviceLines: [...prev.serviceLines, newLine] }));
  };

  const removeServiceLine = (id: string) => {
    updateData(prev => ({ ...prev, serviceLines: prev.serviceLines.filter(l => l.id !== id) }));
  };

  const updateServiceLine = (id: string, updates: Partial<ServiceLine>) => {
    updateData(prev => ({
      ...prev,
      serviceLines: prev.serviceLines.map(l => l.id === id ? { ...l, ...updates } : l)
    }));
  };

  const exportPDF = () => {
    const doc = new jsPDF() as any;
    const margin = 15;
    
    // Header
    doc.setFontSize(20);
    doc.text(data.insurance.payerName || 'Explanation of Benefits', margin, 20);
    if (data.insurance.payerAddress) {
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(data.insurance.payerAddress, margin, 26, { maxWidth: 80 });
      doc.setTextColor(0);
    }
    doc.setFontSize(10);
    doc.text(`Generated: ${formatUSDate(new Date().toISOString().split('T')[0])}`, 150, 20);
    doc.text('Explanation of Benefits', 150, 26);

    // Patient & Claim Info
    doc.setFontSize(12);
    doc.text('Patient & Claim Information', margin, 45);
    doc.setFontSize(10);
    doc.text(`Patient: ${data.patient.fullName}`, margin, 51);
    doc.text(`DOB: ${formatUSDate(data.patient.dob)}`, margin, 56);
    doc.text(`Member ID: ${data.patient.memberId}`, margin, 61);
    doc.text(`Primary Payer Claim #: ${data.claim.claimNumber}`, 100, 51);
    doc.text(`Check #: ${data.claimTotals.checkNumber || 'N/A'}`, 100, 56);
    if (data.claimTotals.checkDetails) {
      doc.setFontSize(7);
      doc.text(`Details: ${data.claimTotals.checkDetails}`, 100, 60, { maxWidth: 80 });
      doc.setFontSize(10);
      doc.text(`DOS: ${formatDosRange(data.claim.dosStart, data.claim.dosEnd)}`, 100, 67);
    } else {
      doc.text(`DOS: ${formatDosRange(data.claim.dosStart, data.claim.dosEnd)}`, 100, 61);
    }

    // Provider Info
    doc.text('Provider Information', margin, 75);
    doc.text(`Billing: ${data.providers.billingName}`, margin, 81);
    if (data.providers.billingAddress) {
      doc.setFontSize(8);
      doc.setTextColor(100);
      doc.text(data.providers.billingAddress, margin, 86, { maxWidth: 80 });
      doc.setTextColor(0);
      doc.setFontSize(10);
      doc.text(`Tax ID: ${data.providers.taxId}`, margin, 96);
      doc.text(`Billing NPI: ${data.providers.billingNpi}`, margin, 101);
      doc.text(`Rendering: ${data.providers.renderingName} (NPI: ${data.providers.renderingNpi})`, margin, 106);
    } else {
      doc.text(`Tax ID: ${data.providers.taxId}`, margin, 86);
      doc.text(`Billing NPI: ${data.providers.billingNpi}`, margin, 91);
      doc.text(`Rendering: ${data.providers.renderingName} (NPI: ${data.providers.renderingNpi})`, margin, 96);
    }

    // Service Lines Table
    const tableData = data.serviceLines.map(l => [
      formatUSDate(l.dateOfService),
      `${l.cpt}${l.modifiers ? `-${l.modifiers}` : ''}`,
      l.units,
      formatCurrency(l.billedAmount),
      formatCurrency(l.allowedAmount),
      formatCurrency(l.paidAmount),
      l.adjustments.map(a => `${a.groupCode}-${a.carc}${a.rarc ? ` (${a.rarc})` : ''}`).join(', '),
      formatCurrency(l.patientResponsibility.deductible + l.patientResponsibility.coinsurance + l.patientResponsibility.copay)
    ]);

    autoTable(doc, {
      startY: data.providers.billingAddress ? 115 : 105,
      head: [['DOS', 'CPT', 'Units', 'Billed', 'Allowed', 'Paid', 'Adjustments', 'Pt Resp']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [15, 23, 42] }
    });

    // Totals
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.text('Summary Totals', margin, finalY);
    doc.text(`Total Billed: ${formatCurrency(data.claimTotals.billedAmount)}`, margin, finalY + 6);
    doc.text(`Total Allowed: ${formatCurrency(data.claimTotals.allowedAmount)}`, margin, finalY + 11);
    doc.text(`Total Paid: ${formatCurrency(data.claimTotals.paidAmount)}`, 100, finalY + 6);
    doc.text(`Pt Responsibility: ${formatCurrency(data.claimTotals.patientResponsibility)}`, 100, finalY + 11);

    if (data.remarks) {
      doc.text('Remarks:', margin, finalY + 25);
      doc.setFontSize(9);
      doc.text(data.remarks, margin, finalY + 30, { maxWidth: 180 });
    }

    // Code Glossary in PDF
    const glossaryY = data.remarks ? finalY + 50 : finalY + 25;
    doc.setFontSize(10);
    doc.text('Adjustment & Remark Code Glossary:', margin, glossaryY);
    doc.setFontSize(8);
    let currentY = glossaryY + 6;

    const glossaryItems: { group: string; code: string; desc: string }[] = [];
    data.serviceLines.forEach(l => {
      l.adjustments.forEach(a => {
        if (!glossaryItems.find(i => i.group === a.groupCode && i.code === a.carc)) {
          glossaryItems.push({
            group: a.groupCode,
            code: a.carc,
            desc: a.description || getCarcDescription(a.carc)
          });
        }
      });
    });

    glossaryItems.forEach(item => {
      doc.text(`${item.group} ${item.code}: ${item.desc}`, margin, currentY);
      currentY += 5;
    });

    // Ensure PR2 is mentioned if not already there
    if (!glossaryItems.find(i => i.group === 'PR' && i.code === '2')) {
      doc.text(`PR 2: Coinsurance Amount`, margin, currentY);
      currentY += 5;
    }

    const uniqueRarcs = Array.from(new Set(data.serviceLines.flatMap(l => l.adjustments.filter(a => a.rarc).map(a => a.rarc!)))) as string[];
    uniqueRarcs.forEach(code => {
      doc.text(`RARC ${code}: ${getRarcDescription(code)}`, margin, currentY);
      currentY += 5;
    });

    doc.save(`EOB_${data.claim.claimNumber}.pdf`);
  };

  const exportJSON = () => {
    const json = {
      loop2320: {
        otherSubscriber: data.patient.fullName,
        payer: data.insurance.payerName,
        policy: data.insurance.policyNumber,
        taxId: data.providers.taxId,
        claimTotals: {
          ...data.claimTotals,
          checkDetails: data.claimTotals.checkDetails
        }
      },
      loop2430: data.serviceLines.map(l => ({
        dos: formatUSDate(l.dateOfService),
        cpt: l.cpt,
        modifiers: l.modifiers,
        diagPointers: l.diagPointers,
        adjudication: {
          allowed: l.allowedAmount,
          paid: l.paidAmount,
          adjustments: l.adjustments.map(a => ({
            group: a.groupCode,
            code: a.carc,
            amount: a.amount,
            description: a.description || getCarcDescription(a.carc)
          }))
        }
      }))
    };
    const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `837P_COB_${data.claim.claimNumber}.json`;
    a.click();
  };

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center relative">
      {/* Watermark */}
      <div className="fixed inset-0 flex items-center justify-center pointer-events-none opacity-[0.03] z-0 overflow-hidden select-none">
        <div className="text-[20vw] font-black uppercase -rotate-45 whitespace-nowrap">
          Hassan Shah
        </div>
      </div>

      <header className="w-full max-w-4xl mb-8 text-center relative z-10">
        <div className="flex justify-between items-center mb-6">
          <div className="flex gap-2">
            <button onClick={undo} disabled={history.length === 0} className="p-2 bg-white rounded-xl shadow-sm hover:bg-slate-50 disabled:opacity-30 transition-all" title="Undo">
              <Undo2 size={18} />
            </button>
            <button onClick={redo} disabled={redoStack.length === 0} className="p-2 bg-white rounded-xl shadow-sm hover:bg-slate-50 disabled:opacity-30 transition-all" title="Redo">
              <Redo2 size={18} />
            </button>
          </div>
          <div className="flex gap-2">
            <button onClick={saveDraft} className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl shadow-sm hover:bg-slate-50 transition-all text-sm font-medium" title="Save Draft">
              <Save size={18} /> Save Draft
            </button>
            <button onClick={resetForm} className="flex items-center gap-2 px-3 py-2 bg-white rounded-xl shadow-sm hover:bg-error/5 text-error rounded-xl transition-all text-sm font-medium" title="Reset Form">
              <RotateCcw size={18} /> Reset
            </button>
          </div>
        </div>

        <div className="inline-flex items-center justify-center p-3 bg-primary text-white rounded-2xl mb-4 shadow-lg">
          <FileText size={32} />
        </div>
        <h1 className="text-3xl font-bold text-primary">RCM EOB Generator</h1>
        <p className="text-slate-500 mt-2">Professional Primary EOB Adjudication for Secondary Billing</p>
      </header>

      {/* Step Progress */}
      <div className="w-full max-w-4xl mb-8 overflow-x-auto pb-4">
        <div className="flex items-center justify-between min-w-[800px]">
          {STEPS.map((step, idx) => (
            <React.Fragment key={step.id}>
              <div className="flex flex-col items-center gap-2">
                <div className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300",
                  currentStep === step.id ? "bg-accent text-white shadow-lg scale-110" : 
                  idx < currentStepIndex ? "bg-success text-white" : "bg-white text-slate-400 border border-slate-200"
                )}>
                  <step.icon size={20} />
                </div>
                <span className={cn(
                  "text-xs font-medium whitespace-nowrap",
                  currentStep === step.id ? "text-accent" : "text-slate-400"
                )}>
                  {step.label}
                </span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={cn(
                  "h-[2px] flex-1 mx-2",
                  idx < currentStepIndex ? "bg-success" : "bg-slate-200"
                )} />
              )}
            </React.Fragment>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <main className="w-full max-w-4xl glass-card p-6 md:p-8 mb-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="space-y-6"
          >
            {/* Step 0: Denial Reason */}
            {currentStep === 'DENIAL' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <AlertCircle className="text-accent" /> Step 0: Adjudication Context (Optional)
                </h2>
                <p className="text-slate-500">Enter the primary insurance denial reason or payment context to automatically suggest adjustment codes. Skip if generating a standard paid EOB.</p>
                <textarea
                  className="input-field min-h-[120px]"
                  placeholder="e.g., COB missing EOB, Contractual adjustment, CO-236..."
                  value={data.denialReason}
                  onChange={(e) => updateDenialReason(e.target.value)}
                />
                {data.denialReason && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="p-4 bg-accent/5 border border-accent/20 rounded-xl">
                    <h3 className="text-sm font-semibold text-accent mb-2">Intelligent Suggestions:</h3>
                    <div className="flex flex-wrap gap-4 text-sm">
                      <div className="flex flex-col">
                        <span className="text-slate-400 text-[10px] uppercase font-bold">Group Code</span>
                        <span className="font-mono">{data.suggestedCodes.groupCode}</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-slate-400 text-[10px] uppercase font-bold">CARC</span>
                        <span className="font-mono">{data.suggestedCodes.carc}</span>
                      </div>
                      {data.suggestedCodes.rarc && (
                        <div className="flex flex-col">
                          <span className="text-slate-400 text-[10px] uppercase font-bold">RARC</span>
                          <span className="font-mono">{data.suggestedCodes.rarc}</span>
                        </div>
                      )}
                    </div>
                    <label className="flex items-center gap-2 mt-4 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={data.useSuggested} 
                        onChange={(e) => updateData(prev => ({ ...prev, useSuggested: e.target.checked }))}
                        className="w-4 h-4 accent-accent"
                      />
                      <span className="text-sm">Use these suggestions for service lines?</span>
                    </label>
                  </motion.div>
                )}
              </div>
            )}

            {/* Step 1: Patient & Claim */}
            {currentStep === 'PATIENT_CLAIM' && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <User className="text-accent" /> Step 1: Patient & Claim Information
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Patient Full Name</label>
                    <input 
                      className="input-field" 
                      value={data.patient.fullName} 
                      onChange={e => updateData(prev => ({ ...prev, patient: { ...prev.patient, fullName: e.target.value } }))} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Date of Birth</label>
                    <input 
                      type="date"
                      className="input-field" 
                      value={data.patient.dob} 
                      onChange={e => updateData(prev => ({ ...prev, patient: { ...prev.patient, dob: e.target.value } }))} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Member ID</label>
                    <input 
                      className="input-field" 
                      value={data.patient.memberId} 
                      onChange={e => updateData(prev => ({ ...prev, patient: { ...prev.patient, memberId: e.target.value } }))} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Primary Payer Claim Number</label>
                    <input 
                      className="input-field" 
                      value={data.claim.claimNumber} 
                      onChange={e => updateData(prev => ({ ...prev, claim: { ...prev.claim, claimNumber: e.target.value } }))} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Claim DOS Start</label>
                    <input 
                      type="date"
                      className="input-field" 
                      value={data.claim.dosStart} 
                      onChange={e => updateData(prev => ({ ...prev, claim: { ...prev.claim, dosStart: e.target.value } }))} 
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Claim DOS End</label>
                    <input 
                      type="date"
                      className="input-field" 
                      value={data.claim.dosEnd} 
                      onChange={e => updateData(prev => ({ ...prev, claim: { ...prev.claim, dosEnd: e.target.value } }))} 
                    />
                  </div>
                </div>
                
                <div className="pt-4 border-t border-slate-100">
                  <h3 className="text-sm font-bold text-slate-400 uppercase mb-4">Provider Details</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Rendering Provider Name</label>
                      <input className="input-field" value={data.providers.renderingName} onChange={e => updateData(prev => ({ ...prev, providers: { ...prev.providers, renderingName: e.target.value } }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Rendering Provider NPI</label>
                      <input className="input-field" maxLength={10} value={data.providers.renderingNpi} onChange={e => updateData(prev => ({ ...prev, providers: { ...prev.providers, renderingNpi: e.target.value } }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Billing Provider Name</label>
                      <input className="input-field" value={data.providers.billingName} onChange={e => updateData(prev => ({ ...prev, providers: { ...prev.providers, billingName: e.target.value } }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Billing Provider NPI</label>
                      <input className="input-field" maxLength={10} value={data.providers.billingNpi} onChange={e => updateData(prev => ({ ...prev, providers: { ...prev.providers, billingNpi: e.target.value } }))} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Tax ID (EIN/SSN)</label>
                      <input className="input-field" maxLength={10} value={data.providers.taxId} onChange={e => updateData(prev => ({ ...prev, providers: { ...prev.providers, taxId: e.target.value } }))} />
                    </div>
                    <div className="space-y-1 md:col-span-2">
                      <label className="text-xs font-medium">Billing Provider Address</label>
                      <textarea 
                        className="input-field min-h-[60px]" 
                        placeholder="Street, City, State, Zip"
                        value={data.providers.billingAddress} 
                        onChange={e => updateData(prev => ({ ...prev, providers: { ...prev.providers, billingAddress: e.target.value } }))} 
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 2: Insurance */}
            {currentStep === 'INSURANCE' && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <Shield className="text-accent" /> Step 2: Primary Insurance Information
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Payer Name</label>
                    <input className="input-field" value={data.insurance.payerName} onChange={e => updateData(prev => ({ ...prev, insurance: { ...prev.insurance, payerName: e.target.value } }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Payer Type</label>
                    <select className="input-field" value={data.insurance.payerType} onChange={e => updateData(prev => ({ ...prev, insurance: { ...prev.insurance, payerType: e.target.value as PayerType } }))}>
                      {Object.values(PayerType).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Policy Number</label>
                    <input className="input-field" value={data.insurance.policyNumber} onChange={e => updateData(prev => ({ ...prev, insurance: { ...prev.insurance, policyNumber: e.target.value } }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Group Number (Optional)</label>
                    <input className="input-field" value={data.insurance.groupNumber} onChange={e => updateData(prev => ({ ...prev, insurance: { ...prev.insurance, groupNumber: e.target.value } }))} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-bold text-slate-400 uppercase">Payer Address</label>
                    <textarea 
                      className="input-field min-h-[60px]" 
                      placeholder="Street, City, State, Zip"
                      value={data.insurance.payerAddress} 
                      onChange={e => updateData(prev => ({ ...prev, insurance: { ...prev.insurance, payerAddress: e.target.value } }))} 
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Claim Totals */}
            {currentStep === 'CLAIM_TOTALS' && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <DollarSign className="text-accent" /> Step 3: Claim-Level Payment Information
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Total Billed Amount</label>
                    <input type="number" className="input-field" value={data.claimTotals.billedAmount} onChange={e => updateData(prev => ({ ...prev, claimTotals: { ...prev.claimTotals, billedAmount: parseFloat(e.target.value) || 0 } }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Total Allowed Amount</label>
                    <input type="number" className="input-field" value={data.claimTotals.allowedAmount} onChange={e => updateData(prev => ({ ...prev, claimTotals: { ...prev.claimTotals, allowedAmount: parseFloat(e.target.value) || 0 } }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Total Paid Amount</label>
                    <input type="number" className="input-field" value={data.claimTotals.paidAmount} onChange={e => updateData(prev => ({ ...prev, claimTotals: { ...prev.claimTotals, paidAmount: parseFloat(e.target.value) || 0 } }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Total Patient Responsibility</label>
                    <input type="number" className="input-field" value={data.claimTotals.patientResponsibility} onChange={e => updateData(prev => ({ ...prev, claimTotals: { ...prev.claimTotals, patientResponsibility: parseFloat(e.target.value) || 0 } }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Payment Date</label>
                    <input type="date" className="input-field" value={data.claimTotals.paymentDate} onChange={e => updateData(prev => ({ ...prev, claimTotals: { ...prev.claimTotals, paymentDate: e.target.value } }))} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">Check/EFT Number</label>
                    <input className="input-field" value={data.claimTotals.checkNumber} onChange={e => updateData(prev => ({ ...prev, claimTotals: { ...prev.claimTotals, checkNumber: e.target.value } }))} />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-xs font-bold text-slate-400 uppercase">Check/Payment Details</label>
                    <textarea 
                      className="input-field min-h-[80px]" 
                      placeholder="e.g. Check issued by Payer Bank, EFT Trace ID, etc."
                      value={data.claimTotals.checkDetails} 
                      onChange={e => updateData(prev => ({ ...prev, claimTotals: { ...prev.claimTotals, checkDetails: e.target.value } }))} 
                    />
                  </div>
                </div>
                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex justify-between text-sm">
                    <span>Validation: Allowed = Paid + Pt Resp</span>
                    <span className={cn(
                      "font-bold",
                      Math.abs(data.claimTotals.allowedAmount - (data.claimTotals.paidAmount + data.claimTotals.patientResponsibility)) < 0.01 ? "text-success" : "text-error"
                    )}>
                      {formatCurrency(data.claimTotals.paidAmount + data.claimTotals.patientResponsibility)} / {formatCurrency(data.claimTotals.allowedAmount)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Step 4: Service Lines */}
            {currentStep === 'SERVICE_LINES' && (
              <div className="space-y-6">
                <div className="flex justify-between items-center">
                  <h2 className="text-xl font-semibold flex items-center gap-2">
                    <List className="text-accent" /> Step 4: Service Line Entry
                  </h2>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setShowBulkPaste(true)}
                      className="btn-secondary flex items-center gap-2 text-sm"
                    >
                      <ClipboardPaste size={16} /> Bulk Paste
                    </button>
                    <button onClick={addServiceLine} className="btn-primary flex items-center gap-2 text-sm">
                      <Plus size={16} /> Add Line
                    </button>
                  </div>
                </div>

                <div className="space-y-8">
                  {data.serviceLines.map((line, idx) => (
                    <div key={line.id} className="p-6 border border-slate-200 rounded-2xl bg-slate-50/50 space-y-4 relative">
                      <button 
                        onClick={() => removeServiceLine(line.id)}
                        className="absolute top-4 right-4 p-2 text-error hover:bg-error/10 rounded-lg transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                      
                      <div className="flex items-center gap-3 mb-2">
                        <span className="w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center text-sm font-bold">
                          {idx + 1}
                        </span>
                        <h3 className="font-bold text-slate-700">Service Adjudication</h3>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">DOS</label>
                          <input type="date" className="input-field text-sm" value={line.dateOfService} onChange={e => updateServiceLine(line.id, { dateOfService: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">CPT/HCPCS</label>
                          <input className="input-field text-sm" value={line.cpt} onChange={e => updateServiceLine(line.id, { cpt: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Units</label>
                          <input type="number" className="input-field text-sm" value={line.units} onChange={e => updateServiceLine(line.id, { units: parseInt(e.target.value) || 0 })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Billed</label>
                          <input type="number" className="input-field text-sm" value={line.billedAmount} onChange={e => updateServiceLine(line.id, { billedAmount: parseFloat(e.target.value) || 0 })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Allowed</label>
                          <input type="number" className="input-field text-sm" value={line.allowedAmount} onChange={e => updateServiceLine(line.id, { allowedAmount: parseFloat(e.target.value) || 0 })} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Paid</label>
                          <input type="number" className="input-field text-sm" value={line.paidAmount} onChange={e => updateServiceLine(line.id, { paidAmount: parseFloat(e.target.value) || 0 })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Modifiers</label>
                          <input className="input-field text-sm" value={line.modifiers} placeholder="e.g. 26,59" onChange={e => updateServiceLine(line.id, { modifiers: e.target.value })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Diag Pointers</label>
                          <input className="input-field text-sm" value={line.diagPointers} placeholder="e.g. 1,2" onChange={e => updateServiceLine(line.id, { diagPointers: e.target.value })} />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Deductible</label>
                          <input type="number" className="input-field text-sm" value={line.patientResponsibility.deductible} onChange={e => updateServiceLine(line.id, { patientResponsibility: { ...line.patientResponsibility, deductible: parseFloat(e.target.value) || 0 } })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Coinsurance</label>
                          <input type="number" className="input-field text-sm" value={line.patientResponsibility.coinsurance} onChange={e => updateServiceLine(line.id, { patientResponsibility: { ...line.patientResponsibility, coinsurance: parseFloat(e.target.value) || 0 } })} />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase">Copay</label>
                          <input type="number" className="input-field text-sm" value={line.patientResponsibility.copay} onChange={e => updateServiceLine(line.id, { patientResponsibility: { ...line.patientResponsibility, copay: parseFloat(e.target.value) || 0 } })} />
                        </div>
                      </div>

                      {/* Adjustments Sub-section */}
                      <div className="pt-4 border-t border-slate-200">
                        <div className="flex justify-between items-center mb-3">
                          <h4 className="text-xs font-bold text-slate-400 uppercase">Adjustments</h4>
                          <button 
                            onClick={() => {
                              const newAdj: Adjustment = { groupCode: AdjustmentGroupCode.CO, carc: '', amount: 0 };
                              updateServiceLine(line.id, { adjustments: [...line.adjustments, newAdj] });
                            }}
                            className="text-accent text-xs font-bold hover:underline"
                          >
                            + Add Adjustment
                          </button>
                        </div>
                        <div className="space-y-3">
                          {line.adjustments.map((adj, aIdx) => (
                            <div key={aIdx} className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Group</label>
                                <select 
                                  className="input-field text-xs" 
                                  value={adj.groupCode}
                                  onChange={e => {
                                    const newAdjs = [...line.adjustments];
                                    newAdjs[aIdx].groupCode = e.target.value as AdjustmentGroupCode;
                                    updateServiceLine(line.id, { adjustments: newAdjs });
                                  }}
                                >
                                  {Object.values(AdjustmentGroupCode).map(g => <option key={g} value={g}>{g}</option>)}
                                </select>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Code</label>
                                <input 
                                  className="input-field text-xs" 
                                  value={adj.carc}
                                  placeholder="e.g. 45"
                                  onChange={e => {
                                    const newAdjs = [...line.adjustments];
                                    newAdjs[aIdx].carc = e.target.value;
                                    updateServiceLine(line.id, { adjustments: newAdjs });
                                  }}
                                />
                              </div>
                              <div className="space-y-1 md:col-span-2">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Adjustment Reason / Description</label>
                                <input 
                                  className="input-field text-xs" 
                                  value={adj.description || ''}
                                  placeholder="e.g. Contractual Obligation"
                                  onChange={e => {
                                    const newAdjs = [...line.adjustments];
                                    newAdjs[aIdx].description = e.target.value;
                                    updateServiceLine(line.id, { adjustments: newAdjs });
                                  }}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase">Amount</label>
                                <input 
                                  type="number"
                                  className="input-field text-xs" 
                                  value={adj.amount}
                                  onChange={e => {
                                    const newAdjs = [...line.adjustments];
                                    newAdjs[aIdx].amount = parseFloat(e.target.value) || 0;
                                    updateServiceLine(line.id, { adjustments: newAdjs });
                                  }}
                                />
                              </div>
                              <div className="flex gap-2">
                                <div className="space-y-1 flex-1">
                                  <label className="text-[10px] font-bold text-slate-400 uppercase">RARC</label>
                                  <input 
                                    className="input-field text-xs" 
                                    value={adj.rarc || ''}
                                    placeholder="N24"
                                    onChange={e => {
                                      const newAdjs = [...line.adjustments];
                                      newAdjs[aIdx].rarc = e.target.value;
                                      updateServiceLine(line.id, { adjustments: newAdjs });
                                    }}
                                  />
                                </div>
                                <button 
                                  onClick={() => {
                                    const newAdjs = line.adjustments.filter((_, i) => i !== aIdx);
                                    updateServiceLine(line.id, { adjustments: newAdjs });
                                  }}
                                  className="p-2 text-error hover:bg-error/5 rounded-lg self-end"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Line Validation */}
                      <div className="mt-4 flex flex-wrap gap-4 text-[10px] font-bold uppercase">
                        <div className={cn(
                          "px-2 py-1 rounded",
                          Math.abs(line.billedAmount - (line.allowedAmount + line.adjustments.reduce((s, a) => s + a.amount, 0))) < 0.01 ? "bg-success/10 text-success" : "bg-error/10 text-error"
                        )}>
                          Billed = Allowed + Adj
                        </div>
                        <div className={cn(
                          "px-2 py-1 rounded",
                          Math.abs(line.allowedAmount - (line.paidAmount + line.patientResponsibility.deductible + line.patientResponsibility.coinsurance + line.patientResponsibility.copay)) < 0.01 ? "bg-success/10 text-success" : "bg-error/10 text-error"
                        )}>
                          Allowed = Paid + Pt Resp
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Step 5: Remarks */}
            {currentStep === 'REMARKS' && (
              <div className="space-y-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <FileText className="text-accent" /> Step 5: Remarks Section
                </h2>
                <p className="text-slate-500">Enter any additional payer remarks or notes from the EOB.</p>
                <textarea
                  className="input-field min-h-[150px]"
                  placeholder="Enter remarks here..."
                  value={data.remarks}
                  onChange={e => updateData(prev => ({ ...prev, remarks: e.target.value }))}
                />
              </div>
            )}

            {/* Step 6: Validation */}
            {currentStep === 'VALIDATION' && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <CheckCircle2 className="text-success" /> Step 6: Final Validation
                </h2>
                
                <div className="space-y-4">
                  {[
                    { label: 'Billed Amount', claim: data.claimTotals.billedAmount, lines: data.serviceLines.reduce((s, l) => s + l.billedAmount, 0) },
                    { label: 'Allowed Amount', claim: data.claimTotals.allowedAmount, lines: data.serviceLines.reduce((s, l) => s + l.allowedAmount, 0) },
                    { label: 'Paid Amount', claim: data.claimTotals.paidAmount, lines: data.serviceLines.reduce((s, l) => s + l.paidAmount, 0) },
                    { label: 'Pt Responsibility', claim: data.claimTotals.patientResponsibility, lines: data.serviceLines.reduce((s, l) => s + (l.patientResponsibility.deductible + l.patientResponsibility.coinsurance + l.patientResponsibility.copay), 0) },
                  ].map(item => (
                    <div key={item.label} className="p-4 bg-white border border-slate-200 rounded-xl flex justify-between items-center">
                      <div>
                        <span className="text-xs font-bold text-slate-400 uppercase">{item.label}</span>
                        <div className="text-lg font-bold text-primary">{formatCurrency(item.claim)}</div>
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-bold text-slate-400 uppercase">Sum of Lines</span>
                        <div className={cn(
                          "text-lg font-bold",
                          Math.abs(item.claim - item.lines) < 0.01 ? "text-success" : "text-error"
                        )}>
                          {formatCurrency(item.lines)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {data.serviceLines.reduce((s, l) => s + l.billedAmount, 0) !== data.claimTotals.billedAmount && (
                  <div className="p-4 bg-error/5 border border-error/20 rounded-xl flex items-start gap-3 text-error">
                    <AlertCircle size={20} className="shrink-0" />
                    <p className="text-sm">Warning: The sum of service line billed amounts does not match the claim total billed amount. Please review your entries.</p>
                  </div>
                )}
              </div>
            )}

            {/* Step 7: Output Preview */}
            {currentStep === 'OUTPUT' && (
              <div className="space-y-6">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <FileText className="text-accent" /> Step 7: EOB Preview
                </h2>
                
                <div className="border-2 border-slate-200 rounded-2xl overflow-hidden bg-white">
                  <div className="p-6 bg-slate-50 border-b border-slate-200 flex justify-between items-start">
                    <div>
                      <div className="text-2xl font-black text-primary italic uppercase tracking-tighter">
                        {data.insurance.payerName || 'Payer Name'}
                      </div>
                      {data.insurance.payerAddress && (
                        <div className="text-[10px] text-slate-500 max-w-[200px] whitespace-pre-line">
                          {data.insurance.payerAddress}
                        </div>
                      )}
                      <div className="text-xs text-slate-500 mt-1">Explanation of Benefits</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold text-slate-400 uppercase">Primary Payer Claim Number</div>
                      <div className="font-mono font-bold">{data.claim.claimNumber || 'N/A'}</div>
                      
                      {data.claimTotals.checkNumber && (
                        <div className="mt-1">
                          <div className="text-[10px] text-slate-400 uppercase font-bold">Check/EFT #</div>
                          <div className="text-xs font-mono font-bold">{data.claimTotals.checkNumber}</div>
                        </div>
                      )}

                      {data.claimTotals.checkDetails && (
                        <div className="mt-1">
                          <div className="text-[10px] text-slate-400 uppercase font-bold">Payment Details</div>
                          <div className="text-[10px] text-slate-500 leading-tight max-w-[200px] ml-auto">{data.claimTotals.checkDetails}</div>
                        </div>
                      )}

                      <div className="text-[10px] text-slate-400 mt-1 uppercase font-bold">DOS Range</div>
                      <div className="text-xs font-mono">{formatDosRange(data.claim.dosStart, data.claim.dosEnd)}</div>
                    </div>
                  </div>

                  <div className="p-6 grid grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div>
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-1">Patient</h4>
                        <div className="font-bold">{data.patient.fullName}</div>
                        <div className="text-sm text-slate-500">DOB: {formatUSDate(data.patient.dob)}</div>
                        <div className="text-sm text-slate-500">ID: {data.patient.memberId}</div>
                      </div>
                      <div>
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-1">Provider</h4>
                        <div className="font-bold">{data.providers.billingName}</div>
                        {data.providers.billingAddress && (
                          <div className="text-xs text-slate-500 whitespace-pre-line mb-1">
                            {data.providers.billingAddress}
                          </div>
                        )}
                        <div className="text-sm text-slate-500">Tax ID: {data.providers.taxId}</div>
                        <div className="text-sm text-slate-500">Billing NPI: {data.providers.billingNpi}</div>
                        <div className="text-sm text-slate-500">Rendering NPI: {data.providers.renderingNpi}</div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="p-4 bg-slate-50 rounded-xl space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Total Billed:</span>
                          <span className="font-bold">{formatCurrency(data.claimTotals.billedAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Allowed:</span>
                          <span className="font-bold">{formatCurrency(data.claimTotals.allowedAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm border-t border-slate-200 pt-2">
                          <span className="text-slate-500">Paid:</span>
                          <span className="font-bold text-success">{formatCurrency(data.claimTotals.paidAmount)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-slate-500">Pt Resp:</span>
                          <span className="font-bold text-error">{formatCurrency(data.claimTotals.patientResponsibility)}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="px-6 pb-6 overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200">
                          <th className="py-3 font-bold text-slate-400 uppercase text-[10px]">DOS</th>
                          <th className="py-3 font-bold text-slate-400 uppercase text-[10px]">CPT</th>
                          <th className="py-3 font-bold text-slate-400 uppercase text-[10px] text-right">Billed</th>
                          <th className="py-3 font-bold text-slate-400 uppercase text-[10px] text-right">Allowed</th>
                          <th className="py-3 font-bold text-slate-400 uppercase text-[10px] text-right">Paid</th>
                          <th className="py-3 font-bold text-slate-400 uppercase text-[10px]">Adjustments</th>
                          <th className="py-3 font-bold text-slate-400 uppercase text-[10px] text-right">Pt Resp</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.serviceLines.map((l, i) => (
                          <tr key={i} className="border-b border-slate-100 last:border-0">
                            <td className="py-3 text-[10px]">{formatUSDate(l.dateOfService)}</td>
                            <td className="py-3 font-mono">
                              {l.cpt}
                              {l.modifiers && <span className="text-[10px] text-slate-400 ml-1">-{l.modifiers}</span>}
                            </td>
                            <td className="py-3 text-right">{formatCurrency(l.billedAmount)}</td>
                            <td className="py-3 text-right">{formatCurrency(l.allowedAmount)}</td>
                            <td className="py-3 text-right font-bold text-success">{formatCurrency(l.paidAmount)}</td>
                            <td className="py-3">
                              <div className="flex flex-wrap gap-1">
                                {l.adjustments.map((a, ai) => (
                                  <span key={ai} className="px-1.5 py-0.5 bg-slate-100 rounded text-[10px] font-mono" title={a.description || getCarcDescription(a.carc)}>
                                    {a.groupCode}-{a.carc}{a.rarc ? `:${a.rarc}` : ''}
                                  </span>
                                ))}
                              </div>
                            </td>
                            <td className="py-3 text-right font-bold text-error">
                              {formatCurrency(l.patientResponsibility.deductible + l.patientResponsibility.coinsurance + l.patientResponsibility.copay)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {data.remarks && (
                    <div className="p-6 bg-slate-50 border-t border-slate-200">
                      <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">Remarks</h4>
                      <p className="text-xs text-slate-600 italic leading-relaxed">{data.remarks}</p>
                    </div>
                  )}

                  {/* Code Glossary */}
                  <div className="p-6 border-t border-slate-200">
                    <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-3">Adjustment & Remark Code Glossary</h4>
                    <div className="space-y-2">
                      {/* Group adjustments by GroupCode and CARC */}
                      {(() => {
                        const glossaryItems: { group: string; code: string; desc: string }[] = [];
                        data.serviceLines.forEach(l => {
                          l.adjustments.forEach(a => {
                            if (!glossaryItems.find(i => i.group === a.groupCode && i.code === a.carc)) {
                              glossaryItems.push({
                                group: a.groupCode,
                                code: a.carc,
                                desc: a.description || getCarcDescription(a.carc)
                              });
                            }
                          });
                        });
                        
                        return (
                          <>
                            {glossaryItems.map(item => (
                              <div key={`${item.group}-${item.code}`} className="text-[11px] flex gap-2">
                                <span className="font-mono font-bold text-accent shrink-0 w-12">{item.group} {item.code}:</span>
                                <span className="text-slate-600">{item.desc}</span>
                              </div>
                            ))}
                            {/* Always mention PR2 if not present */}
                            {!glossaryItems.find(i => i.group === 'PR' && i.code === '2') && (
                              <div className="text-[11px] flex gap-2">
                                <span className="font-mono font-bold text-accent shrink-0 w-12">PR 2:</span>
                                <span className="text-slate-600">Coinsurance Amount</span>
                              </div>
                            )}
                          </>
                        );
                      })()}
                      
                      {(Array.from(new Set(data.serviceLines.flatMap(l => l.adjustments.filter(a => a.rarc).map(a => a.rarc!)))) as string[]).map(code => (
                        <div key={`rarc-${code}`} className="text-[11px] flex gap-2">
                          <span className="font-mono font-bold text-success shrink-0 w-12">RARC {code}:</span>
                          <span className="text-slate-600">{getRarcDescription(code)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step 8: Export */}
            {currentStep === 'EXPORT' && (
              <div className="space-y-8 text-center py-12">
                <div className="space-y-4">
                  <h2 className="text-2xl font-bold">Ready to Export</h2>
                  <p className="text-slate-500">Your EOB has been adjudicated and validated. Choose your output format.</p>
                </div>
                
                <div className="flex flex-col md:flex-row gap-4 justify-center">
                  <button 
                    onClick={exportPDF}
                    className="flex flex-col items-center gap-4 p-8 border-2 border-slate-200 rounded-3xl hover:border-accent hover:bg-accent/5 transition-all group"
                  >
                    <div className="w-16 h-16 bg-error/10 text-error rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <Printer size={32} />
                    </div>
                    <div>
                      <div className="font-bold">PDF Export</div>
                      <div className="text-xs text-slate-400">Print-ready EOB layout</div>
                    </div>
                  </button>

                  <button 
                    onClick={exportJSON}
                    className="flex flex-col items-center gap-4 p-8 border-2 border-slate-200 rounded-3xl hover:border-accent hover:bg-accent/5 transition-all group"
                  >
                    <div className="w-16 h-16 bg-accent/10 text-accent rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FileJson size={32} />
                    </div>
                    <div>
                      <div className="font-bold">JSON (837P)</div>
                      <div className="text-xs text-slate-400">COB Loop 2320/2430 format</div>
                    </div>
                  </button>
                </div>

                <button 
                  onClick={() => {
                    if (confirm('Are you sure you want to start a new EOB? All current data will be lost.')) {
                      resetForm();
                    }
                  }}
                  className="text-slate-400 text-sm hover:text-error transition-colors"
                >
                  Start New Adjudication
                </button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer Controls */}
      <footer className="w-full max-w-4xl flex flex-col gap-4 mt-8 relative z-10">
        <div className="flex justify-between items-center w-full">
          <button 
            onClick={handleBack}
            disabled={currentStepIndex === 0}
            className="btn-secondary flex items-center gap-2"
          >
            <ChevronLeft size={20} /> Back
          </button>

          {errors.length > 0 && (
            <div className="flex items-center gap-2 text-error text-sm font-medium animate-pulse">
              <AlertCircle size={16} /> {errors.length} Validation Error{errors.length > 1 ? 's' : ''}
            </div>
          )}

          <button 
            onClick={handleNext}
            disabled={currentStep === 'EXPORT'}
            className="btn-primary flex items-center gap-2"
          >
            {currentStep === 'OUTPUT' ? 'Finalize' : 'Next'} <ChevronRight size={20} />
          </button>
        </div>
        
        <div className="text-center text-slate-400 text-xs pb-4 border-t border-slate-100 pt-4">
          This tool created by <span className="font-bold text-slate-600">Hassan Shah</span>
        </div>
      </footer>

      {/* Bulk Paste Modal */}
      <AnimatePresence>
        {showBulkPaste && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-primary/20 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={() => setShowBulkPaste(false)}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl p-8 max-w-2xl w-full shadow-2xl space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold">Bulk Paste Service Lines</h3>
              <p className="text-sm text-slate-500">
                Paste data from a spreadsheet. Format: <br/>
                <code className="bg-slate-100 px-1 rounded">DOS, CPT, Units, Billed, Allowed, Paid, Deductible, Coinsurance, Copay</code>
              </p>
              <textarea 
                className="input-field h-64 font-mono text-xs"
                placeholder="2024-01-01	99213	1	150	100	80	20	0	0"
                value={bulkPasteText}
                onChange={e => setBulkPasteText(e.target.value)}
              />
              <div className="flex gap-4">
                <button onClick={() => setShowBulkPaste(false)} className="btn-secondary flex-1">
                  Cancel
                </button>
                <button onClick={handleBulkPaste} className="btn-primary flex-1">
                  Import Lines
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Modal Overlay */}
      <AnimatePresence>
        {errors.length > 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-primary/20 backdrop-blur-sm flex items-center justify-center p-4 z-50"
            onClick={() => setErrors([])}
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl space-y-4"
              onClick={e => e.stopPropagation()}
            >
              <div className="w-12 h-12 bg-error/10 text-error rounded-2xl flex items-center justify-center">
                <AlertCircle size={24} />
              </div>
              <h3 className="text-xl font-bold">Validation Required</h3>
              <ul className="space-y-2">
                {errors.map((err, i) => (
                  <li key={i} className="text-sm text-slate-600 flex items-start gap-2">
                    <div className="w-1.5 h-1.5 bg-error rounded-full mt-1.5 shrink-0" />
                    {err}
                  </li>
                ))}
              </ul>
              <button onClick={() => setErrors([])} className="btn-primary w-full">
                I'll fix it
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
