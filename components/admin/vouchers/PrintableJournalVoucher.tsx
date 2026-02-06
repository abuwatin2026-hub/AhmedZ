import PrintableVoucherBase, { VoucherData } from './PrintableVoucherBase';

export default function PrintableJournalVoucher(props: { data: Omit<VoucherData, 'title'>; brand?: any }) {
  return <PrintableVoucherBase data={{ ...props.data, title: 'قيد يومية (JV)' }} brand={props.brand} />;
}
