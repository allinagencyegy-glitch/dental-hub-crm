import Link from 'next/link';
import { CrmIcon } from '@/components/crm/CrmIcon';
import { Avatar, Badge, PageHeader, Toolbar } from '@/components/crm/Ui';
import { customers, formatEgp } from '@/lib/crm-ui/mock-data';

export default function CustomersPage() {
  const customerCount = customers.filter((item) => item.lifecycle === 'CUSTOMER').length;
  const prospectCount = customers.length - customerCount;
  return <>
    <PageHeader eyebrow="Account management" title="Customers & Accounts" description="One reliable account record for every buying relationship." actionLabel="Add account" />
    <section className="mb-4 grid grid-cols-3 gap-3">
      <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">All accounts</p><p className="mt-1.5 text-xl font-semibold text-[#1d2a33]">{customers.length}</p></div>
      <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Customers</p><p className="mt-1.5 text-xl font-semibold text-[#168060]">{customerCount}</p></div>
      <div className="rounded-xl bg-white px-4 py-3 ring-1 ring-[#dfe5e8]"><p className="text-[9px] font-bold uppercase tracking-[0.1em] text-[#929ca3]">Prospects</p><p className="mt-1.5 text-xl font-semibold text-[#6c52b5]">{prospectCount}</p></div>
    </section>
    <div className="overflow-hidden rounded-xl shadow-[0_1px_2px_rgba(20,35,45,.04)]">
      <Toolbar placeholder="Search account, contact or phone...">
        <button type="button" className="h-9 rounded-lg border border-[#dce2e5] bg-white px-3 text-[11px] font-semibold text-[#5b6871]">All lifecycle stages</button>
      </Toolbar>
      <div className="overflow-x-auto border-x border-b border-[#dfe5e8] bg-white">
        <table className="w-full min-w-[1050px] text-left"><thead className="border-b border-[#e5eaec] bg-[#f8fafb] text-[9px] font-bold uppercase tracking-[0.1em] text-[#8b969e]"><tr><th className="px-4 py-3">Account</th><th className="px-3 py-3">Main contact</th><th className="px-3 py-3">Phone</th><th className="px-3 py-3">Lifecycle</th><th className="px-3 py-3">Active opportunities</th><th className="px-3 py-3">Last activity</th><th className="px-3 py-3">Products / history</th><th className="w-10 px-3 py-3" /></tr></thead>
          <tbody className="divide-y divide-[#edf0f1]">{customers.map((customer) => <tr key={customer.slug} className="group transition hover:bg-[#fafcfc]"><td className="px-4 py-3.5"><Link href={customer.slug === 'fathy-dental-clinic' ? '/crm/ui-preview/customers/fathy-dental-clinic' : '/crm/ui-preview/customers'} className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#edf5f4] text-[#16877b]"><CrmIcon name="building" className="h-4 w-4" /></span><div><p className="text-[11px] font-semibold text-[#202e37] group-hover:text-[#0e897e]">{customer.clinic}</p><p className="mt-0.5 text-[9px] text-[#919ba2]">{customer.city}</p></div></Link></td><td className="px-3 py-3.5"><div className="flex items-center gap-2"><Avatar name={customer.contact} /><span className="text-[10px] font-medium text-[#4e5c65]">{customer.contact}</span></div></td><td className="px-3 py-3.5 text-[10px] text-[#66737c]">{customer.phone}</td><td className="px-3 py-3.5"><Badge value={customer.lifecycle} dot /></td><td className="px-3 py-3.5">{customer.activeOpportunities ? <div><p className="text-[10px] font-semibold text-[#34424b]">{customer.activeOpportunities} open</p><p className="mt-0.5 text-[9px] text-[#168276]">{formatEgp(customer.activeValue)}</p></div> : <span className="text-[10px] text-[#9aa3a9]">None active</span>}</td><td className="px-3 py-3.5 text-[10px] text-[#68757e]">{customer.lastActivity}</td><td className="px-3 py-3.5"><div className="flex flex-wrap gap-1">{customer.products.slice(0, 2).map((product) => <span key={product} className="rounded bg-[#f0f3f4] px-2 py-1 text-[9px] font-medium text-[#68757e]">{product}</span>)}</div></td><td className="px-3 py-3.5"><CrmIcon name="chevron" className="h-4 w-4 text-[#a0a8ad]" /></td></tr>)}</tbody>
        </table>
        <div className="flex items-center justify-between border-t border-[#edf0f1] px-4 py-3"><p className="text-[10px] text-[#89949c]">Showing {customers.length} account records · No duplicate contacts</p><p className="text-[9px] font-semibold text-[#839098]">Updated just now</p></div>
      </div>
    </div>
  </>;
}
