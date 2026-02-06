import PrintableVoucherBase, { VoucherData } from './PrintableVoucherBase';

export default function PrintableReceiptVoucher(props: { data: Omit<VoucherData, 'title'>; brand?: any }) {
  return <PrintableVoucherBase data={{ ...props.data, title: 'سند قبض' }} brand={props.brand} />;
}
