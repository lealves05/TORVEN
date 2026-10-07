"""Narração (voz feminina pt-BR, Kokoro pf_dora) para out/texts.json → out/tts/<id>.wav + durations.json (cache por conteúdo)."""
import sys, json, os, hashlib, re, soundfile as sf
from kokoro_onnx import Kokoro
items = json.load(open('out/texts.json', encoding='utf-8'))
out = 'out/tts'; os.makedirs(out, exist_ok=True)
cache = 'cache'; os.makedirs(cache, exist_ok=True)
# pronúncia: siglas e nomes
FIX = [(r'\bTORVEN\b', 'Tórven'), (r'\bOS\b', 'ó ésse'), (r'\bCPF\b', 'cê pê éfe'), (r'\bCNPJ\b', 'cê ene pê jota'), (r'\bCSV\b', 'cê ésse vê'),
       (r'\bOFX\b', 'ó éfe xis'), (r'\bPDF\b', 'pê dê éfe'), (r'\bLGPD\b', 'éle gê pê dê'), (r'\bQR\b', 'quiú ár'), (r'\bDRE\b', 'dê érre é'),
       (r'\bNF-e\b', 'nota fiscal eletrônica'), (r'\bNFS-e\b', 'nota fiscal de serviço'), (r'\bXML\b', 'xis ême éle'), (r'\bPIX\b', 'píx'), (r'\bPix\b', 'píx'),
       (r'\bWhatsApp\b', 'uótsápi'), (r'\bCtrl\b', 'Contról'), (r'\bControl\b', 'Contról'), (r'\bK\b', 'cá'), (r'\bTIG\b', 'tígue'), (r'\bMIG\b', 'míg'),
       (r'\bA4\b', 'á quatro'), (r'\b80 mm\b', 'oitenta milímetros'), (r'\bLogo\b', 'Lôgo'), (r'\blogo\b', 'lôgo'), (r'\blogotipo\b', 'logotípo'),
       (r'\bOK\b', 'ôquei'), (r'\bSOL-', 'ésse ó éle '), (r'\bOS-', 'ó ésse ')]
k = None; durs = {}
for it in items:
    text = it['text'].strip()
    for a, b in FIX: text = re.sub(a, b, text)
    h = hashlib.sha1(f"pf_dora|0.92|{text}".encode()).hexdigest()[:16]
    cp = os.path.join(cache, h + '.wav')
    if not os.path.exists(cp):
        if k is None:
            d = os.environ.get('KOKORO_DIR', '/home/claude/tts')
            k = Kokoro(os.path.join(d, 'kokoro-v1.0.onnx'), os.path.join(d, 'voices-v1.0.bin'))
        s, sr = k.create(text, voice='pf_dora', speed=0.92, lang='pt-br')  # um pouco mais devagar: público com pouca prática
        sf.write(cp, s, sr)
    info = sf.info(cp)
    dst = os.path.join(out, it['id'] + '.wav')
    if os.path.lexists(dst): os.remove(dst)
    os.symlink(os.path.abspath(cp), dst)
    durs[it['id']] = info.frames / info.samplerate
json.dump(durs, open(os.path.join(out, 'durations.json'), 'w'), indent=1)
print(f"{len(items)} falas, {sum(durs.values()):.1f}s")
