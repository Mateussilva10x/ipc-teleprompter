# NÃO ME DEFINEM — ATLAS SONORO · Relatório de produção do clipe

## Entregáveis (pasta `saida/`)
| Arquivo | Conteúdo |
|---|---|
| `NAO_ME_DEFINEM_-_Atlas_Sonoro_1080p.mp4` | Vídeo final: 1920×1080, 16:9, 30 fps, H.264 (High, yuv420p), áudio AAC 320 kbps / 48 kHz estéreo |
| `NAO_ME_DEFINEM_-_letra.srt` | Legenda separada com as 96 linhas da letra e seus tempos |
| `tabela_secoes.md` | Tempos de cada seção musical e de cada linha da letra, com o visual correspondente |
| `RELATORIO.md` | Este relatório |

Projeto e arquivos-fonte da edição ficam em `projeto/`:
- `analise_audio.py`: envelope de energia, fluxo espectral, espectrogramas.
- `ssm.py`: matriz de auto-similaridade usada para localizar os refrões e as fronteiras de seção.
- `zoom_vocal.py`: espectrograma do vocal aproximado, usado para conferir onde cada frase começa.
- `tempos.py`: tabela de seções, letra e tempo de cada linha. Gera `trabalho/tempos.json`.
- `render.py`: renderizador do clipe. Cada quadro é calculado a partir do tempo.
- `render_all.sh`: renderização em 4 blocos paralelos e montagem final com o áudio.

Para renderizar de novo: `./projeto/render_all.sh`. Antes disso, rode `projeto/analise_audio.py trabalho` e `projeto/tempos.py trabalho`.

## Arquivos utilizados
| Original enviado | Cópia de trabalho | Uso |
|---|---|---|
| `N_o_me_Definem_-_final.mp3` (259,632 s, MP3 48 kHz estéreo, ~184 kbps) | `fonte/nao-me-definem.mp3` | Áudio completo, sem cortes, sem loops, sem alteração de velocidade |
| imagem 1 (1215×717) | `fonte/1-lee-sin.webp` | Lee Sin |
| imagem 2 (1215×717) | `fonte/2-sett.webp` | Sett |
| imagem 3 (1215×717) | `fonte/3-vayne.webp` | Vayne |
| imagem 4 (1215×717) | `fonte/4-jax.webp` | Jax |
| imagem 5 (1215×717) | `fonte/5-yasuo.webp` | Yasuo |
| Letra (enviada na mensagem) | `projeto/tempos.py` | Texto exibido sem alterações |

Os arquivos originais não foram alterados. Nenhuma imagem extra foi usada e nenhum personagem foi gerado por IA.

## Análise da música
A análise foi feita no áudio real:
- **Andamento:** autocorrelação do fluxo espectral e das batidas do grave. Resultado: ~99 BPM, compasso de ≈2,425 s.
- **Refrões:** uma matriz de auto-similaridade (cromagrama + timbre) mostra o mesmo trecho de 8 compassos repetido três vezes, começando em 49,9 s, 127,5 s e 216,0 s.
- **Fronteiras de seção:** curva de novidade da matriz, quedas e retornos da bateria, e início e fim da voz em espectrogramas ampliados do vocal aproximado (canal central menos laterais).
- **Conferência:** as notas longas que fecham cada par de linhas do refrão ("sou", "apagou", "terminou") caem exatamente onde a grade de compassos prevê.

A tabela completa está em `tabela_secoes.md`. Resumo:

| Seção | Tempo |
|---|---|
| Introdução (instrumental) | 0,0 – 10,9 s |
| Verso 1 — Lee Sin | 10,9 – 40,2 s |
| Pré-refrão | 40,2 – 49,9 s |
| Refrão 1 | 49,9 – 69,3 s |
| Verso 2 — Sett | 69,3 – 98,4 s |
| Verso 3 — Vayne | 98,4 – 127,5 s |
| Refrão 2 | 127,5 – 147,1 s |
| Verso 4 — Jax | 147,1 – 176,6 s |
| Verso 5 — Yasuo | 176,6 – 206,2 s |
| Ponte | 206,2 – 216,0 s |
| Refrão final | 216,0 – 235,5 s |
| Encerramento | 235,5 – 259,632 s (voz até ~248,6 s, depois cauda instrumental) |

## Sincronização da letra: como foi feita e qual a precisão
Não há reconhecimento de fala instalado no ambiente, e a regra era não instalar dependências. Por isso a sincronização foi feita pela análise do sinal:
1. As fronteiras das seções e o início da primeira frase de cada uma foram medidos nos espectrogramas.
2. Dentro de cada seção, cada linha da letra ocupa um compasso. Isso confere com a duração medida de todas as seções: 12 linhas em 12 compassos nos versos, 8 em 8 nos refrões e 4 em 4 no pré-refrão, na ponte e no final.
3. O início de cada linha foi ajustado para o vale de energia vocal mais próximo, que corresponde à respiração antes da frase.
4. As marcas foram sobrepostas aos espectrogramas e conferidas visualmente.

A precisão é por frase: cada linha aparece quando é cantada. Não há sincronização palavra a palavra, porque isso exigiria reconhecimento de fala. As palavras entram em sequência rápida no início da frase, como animação tipográfica. Elas não acompanham a sílaba.

Se você notar alguma linha adiantada ou atrasada ao assistir, o ajuste é simples:
1. Altere o tempo da linha em `AJUSTES` no arquivo `projeto/tempos.py`.
2. Rode `tempos.py` de novo.
3. Renderize de novo.

## Decisões de edição
- **Base visual:** as splash arts foram ampliadas com Lanczos e uma nitidez leve, sem redesenho. Câmera virtual em cada plano com aproximação, deslocamento lateral, tremor nas batidas fortes e ondas de choque.
- **Profundidade:** não há modelo de segmentação no ambiente. Para não deformar a arte com recortes manuais, a profundidade vem de camadas atmosféricas à frente da imagem: chuva, névoa, partículas, pétalas e vento, cada uma com velocidade própria.
- **Impactos:** os flashes, os golpes de zoom e os pulsos das divisões são disparados pelas batidas reais do grave detectadas no áudio.
- **Personagens:**
  - **Lee Sin:** chuva, energia espiritual azul-ciano nos dois punhos e partículas subindo.
  - **Sett:** poeira, brasas e luz quente.
  - **Vayne:** sombras frias deslizando, traços e flashes prateados.
  - **Jax:** a lâmpada na ponta da arma, com o orbe superior como apoio, ganha brilho crescente durante o verso inteiro, como símbolo de esperança. Partículas de luz sobem dela.
  - **Yasuo:** vento, folhas e pétalas, que se intensificam quando o flow dobra.
- **Refrões:**
  - **Refrão 1:** os painéis entram um a um, uma batida para cada.
  - **Refrão 2:** enquadramento mais fechado nos rostos, entrada do centro para fora e cortes individuais em "Se a porta fecha… / se o mundo pesa…".
  - **Refrão final:** os painéis entram em explosão simultânea, com partículas e luz convergindo para o centro e impactos mais fortes.
- **Ponte:** os painéis ficam escuros e sem cor e acendem um a um em "Cinco histórias". A cor volta em "mas não decidem quem serei!".
- **Tipografia:** Inter Display Black e ExtraBold. Palavras-chave aparecem destacadas na cor do personagem. As frases entram palavra a palavra e se deslocam levemente. A posição muda conforme o enquadramento, para não cobrir o personagem. "NÃO ME DEFINEM!" aparece grande no centro, com entrada de impacto e pulso na batida. Uma faixa escura suave atrás do texto dos refrões garante a leitura no celular.
- **Final:** título "NÃO ME DEFINEM" e assinatura "ATLAS SONORO — Histórias que merecem ser ouvidas." sobre os cinco painéis, de 248,3 s até o último quadro.

## Verificação do vídeo renderizado
As verificações foram feitas no MP4 final, não na prévia do projeto.

- **Arquivo:** abre e decodifica de ponta a ponta sem erros. Tem 7.789 quadros, 1920×1080, 30 fps, H.264 High em yuv420p (CRF 18), cerca de 1,0 GB.
- **Duração:** 259,63 s, igual à da música. Vídeo e áudio começam em 0,000 s.
- **Áudio completo:** a sonoridade integrada é idêntica à da fonte (−15,0 LUFS, LRA 8,2). O áudio está em AAC 320 kbps, 48 kHz.
- **Quadros pretos:** o filtro `blackdetect` não encontrou nenhum. O primeiro quadro tem névoa visível e o último mantém o título legível.
- **Personagens e painéis:** quadros amostrados ao longo do clipe mostram os cinco campeões, os painéis alinhados (5 × 384 px) e o título final. O arquivo `verificacao_quadros.png` traz uma amostra.
- **Problemas corrigidos e renderizados de novo:**
  1. Frases que se sobrepunham na troca de linha.
  2. Quatro quadros escuros demais no início.
  3. Faixa preta na base dos painéis.
  4. Bloom que lavava o texto dos refrões.
