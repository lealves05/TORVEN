# Vídeo-aulas do TORVEN (Suporte › treinamento)

28 aulas gravadas no próprio sistema (demonstração), pensadas para quem tem pouca prática com computador:

- **Narração:** voz feminina em português, um pouco mais lenta (Kokoro TTS, voz `pf_dora`, velocidade 0,92).
- **Legenda grande na imagem.** Cada fala tem o próprio áudio, aparece como legenda no instante em que é narrada e vai para o `.vtt`. O `.vtt` é a legenda do player e o "Texto da aula", clicável, na tela de Suporte.
- **Cartão de abertura:** título, para que serve e "Nesta aula você vai aprender".
- **Durante a aula:** selo "Passo 1 de 4", destaque laranja e cursor animado em cada clique.
- **Cartão final:** resumo narrado.

Saída em `frontend/public/treinamento/`: `<aula>.mp4`, `<aula>.vtt`, `<aula>-capa.jpg` (abertura) e `<aula>.jpg` (miniatura).

O gerador também produz dois índices, que não devem ser editados à mão:
- `frontend/src/lib/training.js`: lista completa, usada na tela de Suporte.
- `frontend/src/lib/training-help.js`: só as rotas, usado pelo botão **Ajuda** do topo, que abre a aula da tela atual.

## Regravar

Pré-requisitos:
- Postgres e a API em 3333, com o banco `torvencf`.
- O site gerado e servido com proxy para a API: `cd frontend && npm run build && npx vite preview --port 4173`.
- Nesta pasta: `npm install` (playwright e pg).
- Python com `kokoro-onnx`, `soundfile`, `numpy` e `Pillow`, e o `ffmpeg`.
- O modelo Kokoro (`kokoro-v1.0.onnx` e `voices-v1.0.bin`) em `/home/claude/tts/`, ou na pasta indicada em `KOKORO_DIR`.

```bash
node record.mjs texts                # falas → out/texts.json
python3 tts_batch.py                 # narração → out/tts (cache por conteúdo: só gera o que mudou)
node record.mjs rec 3 4 --dry        # ensaio rápido, sem áudio, com capturas de cada passo em out/dry
python3 sheet.py 03-abrir-os-pela-placa   # folha de contato do ensaio (out/sheet-*.jpg) para revisar
node record.mjs rec                  # grava todas (ou informe os números)
python3 compose.py [--sync]          # monta mp4 + vtt + capas em out/final
cp out/final/* ../../frontend/public/treinamento/ && node gen-training.mjs
```

O roteiro fica em `lessons.mjs`. Cada passo tem:
- `act`: o que acontece na tela;
- `say`: as falas, que também viram legendas;
- `tag`: o nome do passo, que aparece no selo.

Escreva frases curtas, com uma ação por vez, e diga *onde* olhar na tela ("no alto, à direita").

Outros detalhes:
- **Aula 5 (voz):** usa fala simulada (`speech`). Cada texto vazio na lista é uma "rodada sem fala", e três rodadas encerram o ditado.
- **Aula 26 (Suporte):** mostra as próprias aulas. Grave-a depois das demais e depois do build do frontend com os vídeos novos.
- **Pronúncia** de siglas e nomes (TORVEN, OS, PIX, CNPJ…): lista `FIX` do `tts_batch.py`.
