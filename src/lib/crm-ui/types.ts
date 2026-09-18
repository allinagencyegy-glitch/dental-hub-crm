export type LeadStatus = 'NEW' | 'CONTACTED' | 'CONVERTED';

export type LeadSource = 'Facebook' | 'WhatsApp' | 'Instagram' | 'Exhibition' | 'Phone';

export type Lead = {
  id: string;
  receivedAt: string;
  receivedDate: string;
  name: string;
  business: string;
  phone: string;
  email?: string;
  source: LeadSource;
  channel: string;
  productInterest: string;
  owner: string;
  status: LeadStatus;
  location: string;
  note: string;
};

export type OpportunityStage = 'QUALIFICATION' | 'QUOTATION' | 'NEGOTIATION';

export type Opportunity = {
  id: string;
  account: string;
  contact: string;
  phone: string;
  product: string;
  amount: number;
  owner: string;
  stage: OpportunityStage;
  nextAction?: string;
  dueAt?: string;
  dueLabel?: string;
  isOverdue?: boolean;
  isOnHold?: boolean;
  sourceLead?: string;
  note: string;
};

export type CustomerLifecycle = 'PROSPECT' | 'CUSTOMER';

export type Customer = {
  slug: string;
  clinic: string;
  contact: string;
  phone: string;
  email: string;
  city: string;
  lifecycle: CustomerLifecycle;
  activeOpportunities: number;
  activeValue: number;
  lastActivity: string;
  products: string[];
  owner: string;
  since: string;
};

export type FollowUpStatus = 'OVERDUE' | 'TODAY' | 'UPCOMING' | 'COMPLETED';

export type FollowUpType = 'Call' | 'WhatsApp' | 'Meeting' | 'Email' | 'Demo';

export type FollowUp = {
  id: string;
  type: FollowUpType;
  status: FollowUpStatus;
  dueTime: string;
  dueDate: string;
  customer: string;
  contact: string;
  linkedTo: string;
  linkedType: 'Opportunity' | 'Lead';
  assignedRep: string;
  notes: string;
};

export type Activity = {
  id: string;
  type: FollowUpType | 'Status change' | 'Note';
  title: string;
  detail: string;
  actor: string;
  time: string;
};
