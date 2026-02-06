import PrintableVoucherBase, { VoucherData } from './PrintableVoucherBase';

export default function PrintablePaymentVoucher(props: { data: Omit<VoucherData, 'title'>; brand?: any }) {
  return <PrintableVoucherBase data={{ ...props.data, title: 'سند صرف' }} brand={props.brand} />;
}
