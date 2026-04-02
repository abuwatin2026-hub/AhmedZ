import os, json, hashlib, csv
from collections import Counter, defaultdict

current_root = r"C:\nasrflash\AhmedZ"
erp_root = r"C:\nasrflash\AhmedZ\_external\erpnext-v16.12.0\erpnext-16.12.0"
out_dir = r"C:\nasrflash\AhmedZ\comparison_erpnext16_vs_current"

exclude_dirs = {'.git','node_modules','_external'}

def file_hash(path):
    h = hashlib.sha256()
    with open(path,'rb') as f:
        for chunk in iter(lambda: f.read(1024*1024), b''):
            h.update(chunk)
    return h.hexdigest()

def walk_files(root, exclude=None):
    result = {}
    for base, dirs, files in os.walk(root):
        if exclude:
            dirs[:] = [d for d in dirs if d not in exclude]
        for name in files:
            full = os.path.join(base, name)
            rel = os.path.relpath(full, root).replace('\\','/')
            result[rel] = full
    return result

os.makedirs(out_dir, exist_ok=True)

current_files = walk_files(current_root, exclude=exclude_dirs)
erp_files = walk_files(erp_root, exclude={'.git'})

current_set = set(current_files)
erp_set = set(erp_files)

common = sorted(current_set & erp_set)
only_current = sorted(current_set - erp_set)
only_erp = sorted(erp_set - current_set)

identical = []
different = []
for rel in common:
    a = current_files[rel]
    b = erp_files[rel]
    ha = file_hash(a)
    hb = file_hash(b)
    if ha == hb:
        identical.append((rel, ha))
    else:
        different.append((rel, ha, hb))


def ext(rel):
    bn = os.path.basename(rel)
    if '.' not in bn:
        return '<no_ext>'
    return bn.rsplit('.',1)[1].lower()

def top(rel):
    return rel.split('/',1)[0] if '/' in rel else rel

section_stats = defaultdict(lambda: {'current':0,'erpnext':0,'common_paths':0,'identical':0,'different':0,'only_current':0,'only_erpnext':0})
for rel in current_set:
    section_stats[top(rel)]['current'] += 1
for rel in erp_set:
    section_stats[top(rel)]['erpnext'] += 1
for rel in common:
    section_stats[top(rel)]['common_paths'] += 1
for rel,_ in identical:
    section_stats[top(rel)]['identical'] += 1
for rel,_,_ in different:
    section_stats[top(rel)]['different'] += 1
for rel in only_current:
    section_stats[top(rel)]['only_current'] += 1
for rel in only_erp:
    section_stats[top(rel)]['only_erpnext'] += 1

summary = {
    'current_root': current_root,
    'erpnext_root': erp_root,
    'total_files_current': len(current_set),
    'total_files_erpnext': len(erp_set),
    'common_relative_paths': len(common),
    'common_identical_files': len(identical),
    'common_different_files': len(different),
    'only_in_current': len(only_current),
    'only_in_erpnext': len(only_erp),
    'filetype_counts_current_top40': Counter(ext(r) for r in current_set).most_common(40),
    'filetype_counts_erpnext_top40': Counter(ext(r) for r in erp_set).most_common(40),
    'top_level_section_count_current': len({top(r) for r in current_set}),
    'top_level_section_count_erpnext': len({top(r) for r in erp_set}),
}

with open(os.path.join(out_dir,'summary.json'),'w',encoding='utf-8') as f:
    json.dump(summary,f,ensure_ascii=False,indent=2)

with open(os.path.join(out_dir,'top_level_section_comparison.csv'),'w',newline='',encoding='utf-8') as f:
    w=csv.writer(f)
    w.writerow(['section','current','erpnext','common_paths','identical','different','only_current','only_erpnext'])
    for sec in sorted(section_stats):
        s=section_stats[sec]
        w.writerow([sec,s['current'],s['erpnext'],s['common_paths'],s['identical'],s['different'],s['only_current'],s['only_erpnext']])

with open(os.path.join(out_dir,'common_identical.csv'),'w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['relative_path','sha256'])
    for rel,ha in identical:
        w.writerow([rel,ha])

with open(os.path.join(out_dir,'common_different.csv'),'w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['relative_path','sha256_current','sha256_erpnext'])
    for rel,ha,hb in different:
        w.writerow([rel,ha,hb])

with open(os.path.join(out_dir,'only_in_current.csv'),'w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['relative_path'])
    for rel in only_current:
        w.writerow([rel])

with open(os.path.join(out_dir,'only_in_erpnext.csv'),'w',newline='',encoding='utf-8') as f:
    w=csv.writer(f); w.writerow(['relative_path'])
    for rel in only_erp:
        w.writerow([rel])

# create small per-section detail for differing common paths
per_section_diff = defaultdict(list)
for rel,ha,hb in different:
    per_section_diff[top(rel)].append({'relative_path':rel,'sha256_current':ha,'sha256_erpnext':hb})
with open(os.path.join(out_dir,'different_by_section.json'),'w',encoding='utf-8') as f:
    json.dump({k:v for k,v in sorted(per_section_diff.items())},f,ensure_ascii=False,indent=2)

print('DONE')
print('OUT_DIR', out_dir)
print('TOTAL_CURRENT', len(current_set))
print('TOTAL_ERP', len(erp_set))
print('COMMON', len(common))
print('IDENTICAL', len(identical))
print('DIFFERENT', len(different))
print('ONLY_CURRENT', len(only_current))
print('ONLY_ERP', len(only_erp))
