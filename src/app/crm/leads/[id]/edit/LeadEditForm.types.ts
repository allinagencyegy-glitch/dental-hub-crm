export interface SourceOption {
  id: string;
  code: string;
  name: string;
}

export interface ProductCategoryOption {
  id: string;
  code: string;
  name: string;
}

export interface CampaignOption {
  id: string;
  code: string;
  name: string;
}

export interface AssignableOwner {
  id: string;
  displayName: string;
  email: string;
  role: string;
}