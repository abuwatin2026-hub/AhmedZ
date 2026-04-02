import os, json, csv
from collections import Counter, defaultdict

current_root = r"C:\nasrflash\AhmedZ"
erp_root = r"C:\nasrflash\AhmedZ\_external\erpnext-v16.12.0\erpnext-16.12.0"
out_dir = r"C:\nasrflash\AhmedZ\comparison_erpnext16_vs_current"
os.makedirs(out_dir, exist_ok=True)

exclude_current = {'.git','node_modules','_external'}
exclude_erp = {'.git'}

def walk(root, exclude):
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in exclude]
        for f in files:
            full = os.path.join(base,f)
            rel = os.path.relpath(full, root).replace('\\','/')
            yield rel

current_files = list(walk(current_root, exclude_current))
erp_files = list(walk(erp_root, exclude_erp))

current_top = Counter([p.split('/',1)[0] for p in current_files])
erp_top = Counter([p.split('/',1)[0] for p in erp_files])

# page-like artifacts
current_pages = sorted([p for p in current_files if p.startswith('screens/') and p.endswith(('.tsx','.ts','.jsx','.js'))])
erp_pages = sorted([p for p in erp_files if '/page/' in p or '/workspace/' in p or p.endswith('/workspace.json')])

# doctype-like artifacts in ERPNext
erp_doctypes = sorted([p for p in erp_files if '/doctype/' in p and p.endswith('.json')])

# data/backend artifacts in current
current_db = sorted([p for p in current_files if p.startswith('supabase/') or p.startswith('sql/') or p.endswith('.sql')])

# keyword-based objective counts (path contains keyword)
keywords = [
    'account','stock','inventory','payroll','hr','crm','project','buy','sell','manufact',
    'asset','tax','bank','payment','order','invoice','report','warehouse','supplier','customer','pos'
]

def keyword_counts(paths):
    c = {}
    lower = [p.lower() for p in paths]
    for k in keywords:
        c[k] = sum(1 for p in lower if k in p)
    return c

summary = {
    'current_top_level_counts': dict(sorted(current_top.items())),
    'erpnext_top_level_counts': dict(sorted(erp_top.items())),
    'current_page_like_count': len(current_pages),
    'erpnext_page_workspace_like_count': len(erp_pages),
    'erpnext_doctype_json_count': len(erp_doctypes),
    'current_db_related_file_count': len(current_db),
    'keyword_path_counts_current': keyword_counts(current_files),
    'keyword_path_counts_erpnext': keyword_counts(erp_files)
}

with open(os.path.join(out_dir,'structural_analysis.json'),'w',encoding='utf-8') as f:
    json.dump(summary,f,ensure_ascii=False,indent=2)

for name, rows in [
    ('current_page_like.csv', current_pages),
    ('erpnext_page_workspace_like.csv', erp_pages),
    ('erpnext_doctype_json.csv', erp_doctypes),
    ('current_db_related.csv', current_db)
]:
    with open(os.path.join(out_dir,name),'w',newline='',encoding='utf-8') as f:
        w=csv.writer(f); w.writerow(['relative_path'])
        for r in rows:
            w.writerow([r])

print('DONE')
print('CURRENT_PAGES', len(current_pages))
print('ERP_PAGES_WORKSPACES', len(erp_pages))
print('ERP_DOCTYPES', len(erp_doctypes))
print('CURRENT_DB_FILES', len(current_db))
