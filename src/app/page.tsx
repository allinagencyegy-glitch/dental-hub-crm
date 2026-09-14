import { redirect } from 'next/navigation';

/** Dental Hub CRM has a single entry point: the authenticated CRM. */
export default function RootPage() {
  redirect('/crm');
}
