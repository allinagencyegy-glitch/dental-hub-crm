'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { captureLeadAction } from '@/server/crm/leads/actions';
import { canAssignOwner, isRole, type Role } from '@/server/authz/permissions';
import { useMessages } from '@/i18n/I18nProvider';
import { catalogLabel } from '@/i18n/format';

interface SourceOption {
  id: string;
  code: string;
  name: string;
}

interface ProductCategoryOption {
  id: string;
  code: string;
  name: string;
}

interface CampaignOption {
  id: string;
  code: string;
  name: string;
}

interface AssignableOwner {
  id: string;
  displayName: string;
  email: string;
  role: string;
}

interface CaptureLeadFormProps {
  sources: SourceOption[];
  productCategories: ProductCategoryOption[];
  userRole: Role;
}

export function LeadCaptureForm({ sources, productCategories, userRole }: CaptureLeadFormProps) {
  const router = useRouter();
  const m = useMessages();
  const t = m.leads.capture;
  const [formData, setFormData] = useState({
    fullName: '',
    phone: '',
    email: '',
    sourceCode: '',
    campaignCode: '',
    productCategoryCode: '',
    note: '',
    ownerUserId: '',
  });
  const [campaigns, setCampaigns] = useState<CampaignOption[]>([]);
  const [assignableOwners, setAssignableOwners] = useState<AssignableOwner[]>([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [existingLeadId, setExistingLeadId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mayAssignOwner = canAssignOwner(userRole);

  // Load assignable owners for managers/admins
  useEffect(() => {
    if (!mayAssignOwner) return;

    const loadOwners = async () => {
      setLoadingOwners(true);
      try {
        const response = await fetch('/api/crm/leads/owners');
        if (response.ok) {
          const data = await response.json();
          setAssignableOwners(data.owners || []);
        }
      } catch {
        setAssignableOwners([]);
      } finally {
        setLoadingOwners(false);
      }
    };

    loadOwners();
  }, [mayAssignOwner]);

  // Load campaigns when source changes
  useEffect(() => {
    if (!formData.sourceCode) {
      return;
    }

    const loadCampaigns = async () => {
      setLoadingCampaigns(true);
      try {
        const response = await fetch(`/api/crm/leads/campaigns?sourceCode=${formData.sourceCode}`);
        if (response.ok) {
          const data = await response.json();
          setCampaigns(data.campaigns || []);
        }
      } catch {
        setCampaigns([]);
      } finally {
        setLoadingCampaigns(false);
      }
    };

    loadCampaigns();
  }, [formData.sourceCode]);

  const handleChange = (field: string, value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setExistingLeadId(null);
    setFieldErrors({});

    // Validate required fields
    const errors: Record<string, string> = {};
    if (!formData.fullName.trim()) errors.fullName = m.leads.fullNameRequired;
    if (!formData.sourceCode) errors.sourceCode = m.leads.sourceRequired;
    if (!formData.phone.trim() && !formData.email.trim()) {
      errors.phone = m.leads.phoneOrEmailRequired;
      errors.email = m.leads.phoneOrEmailRequired;
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await captureLeadAction({
        fullName: formData.fullName.trim(),
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        sourceCode: formData.sourceCode,
        campaignCode: formData.campaignCode || null,
        productCategoryCode: formData.productCategoryCode || null,
        note: formData.note.trim() || null,
        ownerUserId: formData.ownerUserId || null,
      });

      if (result.ok) {
        router.push(`/crm/leads/${result.leadId}`);
      } else {
        setError(result.message);
        if (result.error === 'DUPLICATE_LEAD' && result.existingLeadId) {
          setExistingLeadId(result.existingLeadId);
        }
      }
    } catch {
      setError(m.common.unexpectedError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        eyebrow={m.leads.eyebrow}
        title={t.heading}
        description={t.description}
      />

      {error && (
        <div className="mb-4 rounded-lg bg-[#ffe9ea] border border-[#f4c7ca] p-4 text-sm text-[#c43f47]" role="alert">
          {error}
          {existingLeadId ? (
            <Link href={`/crm/leads/${existingLeadId}`} className="mt-2 block font-semibold underline">
              {t.openExisting}
            </Link>
          ) : null}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-xl bg-white border border-[#dfe5e8] p-5 space-y-5">
          <h2 className="text-sm font-semibold text-[#1c2831]">{m.leads.contactInformation}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fullName" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.fullName} *
              </label>
              <input
                id="fullName"
                type="text"
                value={formData.fullName}
                onChange={(e) => handleChange('fullName', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] placeholder-[#94a0a9] transition ${
                  fieldErrors.fullName ? 'border-[#f4c7ca] focus:border-[#c43f47]' : 'border-[#dfe4e7] focus:border-[#18b6a4]'
                }`}
                placeholder={m.leads.namePlaceholder}
                disabled={submitting}
              />
              {fieldErrors.fullName && <p className="mt-1 text-[10px] text-[#c43f47]">{fieldErrors.fullName}</p>}
            </div>
            <div>
              <label htmlFor="phone" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.phone}
              </label>
              <input
                id="phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => handleChange('phone', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] placeholder-[#94a0a9] transition ${
                  fieldErrors.phone ? 'border-[#f4c7ca] focus:border-[#c43f47]' : 'border-[#dfe4e7] focus:border-[#18b6a4]'
                }`}
                placeholder="010 1234 5678"
                dir="ltr"
                disabled={submitting}
              />
              {fieldErrors.phone && <p className="mt-1 text-[10px] text-[#c43f47]">{fieldErrors.phone}</p>}
            </div>
            <div>
              <label htmlFor="email" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.email}
              </label>
              <input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => handleChange('email', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] placeholder-[#94a0a9] transition ${
                  fieldErrors.email ? 'border-[#f4c7ca] focus:border-[#c43f47]' : 'border-[#dfe4e7] focus:border-[#18b6a4]'
                }`}
                placeholder="ahmed@clinic.com"
                dir="ltr"
                disabled={submitting}
              />
              {fieldErrors.email && <p className="mt-1 text-[10px] text-[#c43f47]">{fieldErrors.email}</p>}
            </div>
          </div>
          <p className="text-[10px] text-[#8a959d]">{t.identityHint}</p>
        </section>

        <section className="rounded-xl bg-white border border-[#dfe5e8] p-5 space-y-5">
          <h2 className="text-sm font-semibold text-[#1c2831]">{t.classification}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="sourceCode" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.source} *
              </label>
              <select
                id="sourceCode"
                value={formData.sourceCode}
                onChange={(e) => handleChange('sourceCode', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] transition ${
                  fieldErrors.sourceCode ? 'border-[#f4c7ca] focus:border-[#c43f47]' : 'border-[#dfe4e7] focus:border-[#18b6a4]'
                }`}
                disabled={submitting}
              >
                <option value="">{m.leads.selectSource}</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.code}>
                    {catalogLabel(m.catalog.sources, source.code, source.name)}
                  </option>
                ))}
              </select>
              {fieldErrors.sourceCode && <p className="mt-1 text-[10px] text-[#c43f47]">{fieldErrors.sourceCode}</p>}
            </div>
            <div>
              <label htmlFor="campaignCode" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.campaign}
              </label>
              <select
                id="campaignCode"
                value={formData.campaignCode}
                onChange={(e) => handleChange('campaignCode', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] transition border-[#dfe4e7] focus:border-[#18b6a4]`}
                disabled={submitting || loadingCampaigns || campaigns.length === 0}
              >
                <option value="">{m.leads.selectCampaign}</option>
                {loadingCampaigns ? (
                  <option value="" disabled>{m.common.loading}</option>
                ) : (
                  campaigns.map((campaign) => (
                    <option key={campaign.id} value={campaign.code}>
                      {campaign.name}
                    </option>
                  ))
                )}
              </select>
              {!formData.sourceCode ? (
                <p className="mt-1 text-[10px] text-[#8a959d]">{t.chooseSourceFirst}</p>
              ) : loadingCampaigns ? (
                <p className="mt-1 text-[10px] text-[#8a959d]">{t.loadingCampaigns}</p>
              ) : campaigns.length === 0 ? (
                <p className="mt-1 text-[10px] text-[#8a959d]">{t.noCampaigns}</p>
              ) : null}
            </div>
            <div>
              <label htmlFor="productCategoryCode" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.productInterest}
              </label>
              <select
                id="productCategoryCode"
                value={formData.productCategoryCode}
                onChange={(e) => handleChange('productCategoryCode', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] transition border-[#dfe4e7] focus:border-[#18b6a4]`}
                disabled={submitting}
              >
                <option value="">{m.leads.selectCategory}</option>
                {productCategories.map((category) => (
                  <option key={category.id} value={category.code}>
                    {catalogLabel(m.catalog.productCategories, category.code, category.name)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {mayAssignOwner && (
            <div>
              <label htmlFor="ownerUserId" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.owner} *
              </label>
              <select
                id="ownerUserId"
                value={formData.ownerUserId}
                onChange={(e) => handleChange('ownerUserId', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] transition border-[#dfe4e7] focus:border-[#18b6a4]`}
                disabled={submitting || loadingOwners || assignableOwners.length === 0}
                required
              >
                <option value="">{m.leads.selectOwner}</option>
                {loadingOwners ? (
                  <option value="" disabled>{m.common.loading}</option>
                ) : (
                  assignableOwners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {m.leads.ownerOption(owner.displayName, isRole(owner.role) ? m.roles[owner.role] : owner.role)}
                    </option>
                  ))
                )}
              </select>
              <p className="mt-1 text-[10px] text-[#8a959d]">{m.leads.ownerHint}</p>
            </div>
          )}
        </section>

        <section className="rounded-xl bg-white border border-[#dfe5e8] p-5 space-y-5">
          <h2 className="text-sm font-semibold text-[#1c2831]">{m.leads.notes}</h2>
          <div>
            <label htmlFor="note" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
              {m.leads.inquiryContext}
            </label>
            <textarea
              id="note"
              value={formData.note}
              onChange={(e) => handleChange('note', e.target.value)}
              rows={4}
              className="w-full h-28 rounded-lg border border-[#dfe4e7] bg-white px-3 py-2 text-[11px] text-[#17242c] placeholder-[#94a0a9] transition focus:border-[#18b6a4] resize-none"
              placeholder={m.leads.notePlaceholder}
              disabled={submitting}
            />
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dce2e5] bg-white px-4 text-[11px] font-semibold text-[#53616b] transition hover:bg-[#f7f9fa]"
            disabled={submitting}
          >
            {m.common.cancel}
          </button>
          <button
            type="submit"
            className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#132932] px-4 text-[11px] font-semibold text-white transition hover:bg-[#1b3944] disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                {t.submitting}
              </>
            ) : (
              <>
                <CrmIcon name="plus" className="h-4 w-4" />
                {t.submit}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}