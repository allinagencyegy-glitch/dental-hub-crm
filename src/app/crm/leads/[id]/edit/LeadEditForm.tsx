'use client';

import { useState, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/crm/Ui';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { updateLeadAction } from '@/server/crm/leads/actions';
import { canAssignOwner, isRole, type Role } from '@/server/authz/permissions';
import { useMessages } from '@/i18n/I18nProvider';
import { catalogLabel } from '@/i18n/format';
import type { LeadDetail } from '@/server/crm/leads/repository';
import type { SourceOption, ProductCategoryOption, CampaignOption, AssignableOwner } from './LeadEditForm.types';

interface LeadEditFormProps {
  lead: LeadDetail;
  catalog: { sources: SourceOption[]; productCategories: ProductCategoryOption[] };
  assignableOwners: AssignableOwner[];
  userRole: Role;
  userId: string;
}

export function LeadEditForm({ lead, catalog, assignableOwners, userRole }: LeadEditFormProps) {
  const router = useRouter();
  const m = useMessages();
  const t = m.leads.edit;
  const mayAssignOwner = canAssignOwner(userRole);

  const [formData, setFormData] = useState({
    sourceCode: lead.sourceCode || '',
    campaignCode: lead.campaignCode || '',
    productCategoryCode: lead.productCategoryCode || '',
    note: lead.note || '',
    ownerUserId: lead.ownerUserId || '',
    contact: {
      fullName: lead.contactName,
      phone: lead.contactPhone || '',
      email: lead.contactEmail || '',
    },
  });
  const [campaigns, setCampaigns] = useState<CampaignOption[]>(lead.sourceCode ? [] : []);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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

  const handleContactChange = (field: 'fullName' | 'phone' | 'email', value: string) => {
    setFormData((prev) => ({ ...prev, contact: { ...prev.contact, [field]: value } }));
    if (fieldErrors[`contact.${field}`]) {
      setFieldErrors((prev) => ({ ...prev, [`contact.${field}`]: '' }));
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});

    // Validate required fields
    const errors: Record<string, string> = {};
    if (!formData.contact.fullName.trim()) errors['contact.fullName'] = m.leads.fullNameRequired;
    if (!formData.sourceCode) errors.sourceCode = m.leads.sourceRequired;

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setSubmitting(true);
    try {
      const result = await updateLeadAction(lead.id, {
        sourceCode: formData.sourceCode,
        campaignCode: formData.campaignCode || null,
        productCategoryCode: formData.productCategoryCode || null,
        note: formData.note.trim() || null,
        ownerUserId: mayAssignOwner ? (formData.ownerUserId || null) : undefined,
        contact: {
          fullName: formData.contact.fullName.trim(),
          phone: formData.contact.phone.trim() || null,
          email: formData.contact.email.trim() || null,
        },
      });

      if (result.ok) {
        router.push(`/crm/leads/${lead.id}`);
        router.refresh();
      } else {
        if (result.error === 'IDENTITY_CONFLICT') {
          setError(result.message);
          if (result.conflict) {
            if (result.conflict.phoneContactId) {
              setFieldErrors((prev) => ({ ...prev, 'contact.phone': t.phoneTaken }));
            }
            if (result.conflict.emailContactId) {
              setFieldErrors((prev) => ({ ...prev, 'contact.email': t.emailTaken }));
            }
          }
        } else {
          setError(result.message);
        }
      }
    } catch {
      setError(m.common.unexpectedError);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        eyebrow={m.leads.eyebrow}
        title={t.heading}
        description={t.description}
      />

      {error && (
        <div className="mb-4 rounded-lg bg-[#ffe9ea] border border-[#f4c7ca] p-4 text-sm text-[#c43f47]" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="rounded-xl bg-white border border-[#dfe5e8] p-5 space-y-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#1c2831]">{m.leads.contactInformation}</h2>
            <span className="text-[10px] text-[#8a959d]">{t.contactHint}</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="fullName" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.fullName} *
              </label>
              <input
                id="fullName"
                type="text"
                value={formData.contact.fullName}
                onChange={(e) => handleContactChange('fullName', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] placeholder-[#94a0a9] transition ${
                  fieldErrors['contact.fullName'] ? 'border-[#f4c7ca] focus:border-[#c43f47]' : 'border-[#dfe4e7] focus:border-[#18b6a4]'
                }`}
                placeholder={m.leads.namePlaceholder}
                disabled={submitting}
              />
              {fieldErrors['contact.fullName'] && <p className="mt-1 text-[10px] text-[#c43f47]">{fieldErrors['contact.fullName']}</p>}
            </div>
            <div>
              <label htmlFor="phone" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.phone}
              </label>
              <input
                id="phone"
                type="tel"
                value={formData.contact.phone}
                onChange={(e) => handleContactChange('phone', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] placeholder-[#94a0a9] transition ${
                  fieldErrors['contact.phone'] ? 'border-[#f4c7ca] focus:border-[#c43f47]' : 'border-[#dfe4e7] focus:border-[#18b6a4]'
                }`}
                placeholder="010 1234 5678"
                dir="ltr"
                disabled={submitting}
              />
              {fieldErrors['contact.phone'] && <p className="mt-1 text-[10px] text-[#c43f47]">{fieldErrors['contact.phone']}</p>}
            </div>
            <div>
              <label htmlFor="email" className="block text-[10px] font-bold uppercase tracking-[0.1em] text-[#8a959d] mb-1.5">
                {m.leads.email}
              </label>
              <input
                id="email"
                type="email"
                value={formData.contact.email}
                onChange={(e) => handleContactChange('email', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] placeholder-[#94a0a9] transition ${
                  fieldErrors['contact.email'] ? 'border-[#f4c7ca] focus:border-[#c43f47]' : 'border-[#dfe4e7] focus:border-[#18b6a4]'
                }`}
                placeholder="ahmed@clinic.com"
                dir="ltr"
                disabled={submitting}
              />
              {fieldErrors['contact.email'] && <p className="mt-1 text-[10px] text-[#c43f47]">{fieldErrors['contact.email']}</p>}
            </div>
          </div>
          <p className="text-[10px] text-[#8a959d]">{t.identityHint}</p>
        </section>

        <section className="rounded-xl bg-white border border-[#dfe5e8] p-5 space-y-5">
          <h2 className="text-sm font-semibold text-[#1c2831]">{t.attribution}</h2>
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
                {catalog.sources.map((source) => (
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
                {catalog.productCategories.map((category) => (
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
                {m.leads.owner}
              </label>
              <select
                id="ownerUserId"
                value={formData.ownerUserId}
                onChange={(e) => handleChange('ownerUserId', e.target.value)}
                className={`w-full h-9 rounded-lg border bg-white px-3 text-[11px] text-[#17242c] transition border-[#dfe4e7] focus:border-[#18b6a4]`}
                disabled={submitting || assignableOwners.length === 0}
              >
                <option value="">{m.leads.selectOwner}</option>
                {assignableOwners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {m.leads.ownerOption(owner.displayName, isRole(owner.role) ? m.roles[owner.role] : owner.role)}
                  </option>
                ))}
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
                {m.common.saving}
              </>
            ) : (
              <>
                <CrmIcon name="check" className="h-4 w-4" />
                {t.save}
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}