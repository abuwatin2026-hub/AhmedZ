from pypdf import PdfReader
from pathlib import Path
import json
pdf = Path(r"C:\Users\nasrn\Downloads\خطة إنشاء ERP جديد.pdf")
out = Path(r"C:\nasrflash\AhmedZ\_tmp_investor_plan_excerpt.txt")
reader = PdfReader(str(pdf))
texts=[]
for i, page in enumerate(reader.pages[:12], start=1):
    try:
        text = page.extract_text() or ''
    except Exception as e:
        text = f'[EXTRACT_ERROR: {e}]'
    texts.append(f'--- PAGE {i} ---\n{text}\n')
out.write_text('\n'.join(texts), encoding='utf-8')
print(json.dumps({'pages': len(reader.pages), 'out': str(out), 'sample_chars': sum(len(t) for t in texts)} , ensure_ascii=False))
