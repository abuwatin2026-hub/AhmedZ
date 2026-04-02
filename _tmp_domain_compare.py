import os, json
from collections import defaultdict

current_root = r"C:\nasrflash\AhmedZ"
erp_root = r"C:\nasrflash\AhmedZ\_external\erpnext-v16.12.0\erpnext-16.12.0"

exclude_current = {'.git','node_modules','_external','dist','playwright-report','backups'}
exclude_erp = {'.git'}

def walk(root, exclude):
    out=[]
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in exclude]
        for f in files:
            rel = os.path.relpath(os.path.join(base,f), root).replace('\\','/')
            out.append(rel)
    return out

cur = walk(current_root, exclude_current)
erp = walk(erp_root, exclude_erp)

# domains with path keywords
DOMAINS = {
    'purchasing': ['purchase','buying','supplier','procurement','lettersofcredit','importshipment','grn','po_','vendor'],
    'inventory': ['stock','inventory','warehouse','batch','expiry','fefo','bin','reorder','wastage'],
    'sales_pos': ['sales','sell','order','invoice','quotation','pos','checkout','cart','promotion','coupon'],
    'accounting_finance': ['account','ledger','journal','bank','tax','fx','currency','reconciliation','coa','settlement','budget'],
    'hr_payroll': ['hr','employee','attendance','leave','payroll','recruitment','eosb'],
    'crm_customer': ['crm','lead','prospect','customer','review','loyalty','campaign'],
    'projects': ['project','task','timesheet'],
    'manufacturing': ['manufacturing','bom','kitting','production','subcontract'],
    'assets': ['asset','fixedassets'],
    'quality': ['quality','qa','inspection'],
    'reporting_analytics': ['report','dashboard','kpi','analytics','statement'],
    'integration_extensibility': ['api','integration','webhook','functions','supabase','regional','edi','payment'],
    'governance_audit': ['audit','approval','workflow','policy','security','tamper','trace']
}

def analyze(paths):
    lower = [p.lower() for p in paths]
    res = {}
    for d, kws in DOMAINS.items():
        idx=[]
        for i,p in enumerate(lower):
            if any(k in p for k in kws):
                idx.append(i)
        # prioritize business files (screens, doctype, report, page, workspace, sql, py, tsx)
        samples=[]
        for i in idx:
            rp = paths[i]
            if len(samples)>=20:
                break
            if any(t in rp for t in ['/doctype/','/report/','/page/','/workspace/','screens/','contexts/','supabase/','sql/','scripts/']):
                samples.append(rp)
        if len(samples)<10:
            for i in idx:
                rp=paths[i]
                if rp not in samples:
                    samples.append(rp)
                if len(samples)>=10:
                    break
        res[d] = {
            'count': len(idx),
            'samples': samples[:12]
        }
    return res

out={
    'current_total_files': len(cur),
    'erpnext_total_files': len(erp),
    'current_domain_signals': analyze(cur),
    'erpnext_domain_signals': analyze(erp)
}

print(json.dumps(out, ensure_ascii=False, indent=2))
