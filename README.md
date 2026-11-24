# IPC Teleprompter

Aplicativo web (desktop e celular) que lê um **PDF de letras** e o transforma em um
**teleprompter profissional**, preservando **as cores de cada trecho** do PDF
(ex.: cada naipe/voz de uma cantata com sua cor).

Tudo roda no navegador — o PDF não é enviado para nenhum servidor.

## Como usar

1. Abra o app e arraste o PDF (ou toque para escolher). Também aceita `.txt`.
2. Ajuste as configurações na lateral — a pré-visualização mostra o resultado em tempo real.
3. Clique em **▶ Iniciar teleprompter**.

### Leitura do PDF
- Mantém a **cor de cada palavra/trecho** (lida diretamente dos comandos de desenho do PDF).
- **Títulos em negrito** viram músicas/seções (navegáveis).
- **Estrofes** são detectadas pelo espaço entre linhas.
- **Colunas**: lê a coluna da esquerda e depois a da direita.
- Junta automaticamente linhas quebradas pelo layout (opcional).
- Corrige ligaduras do Word que o PDF exporta errado (ex.: `graNdão` → `gratidão`).
- **Localizar e substituir** para corrigir qualquer texto mantendo as cores.

### Configurações
| Aba | Opções |
| --- | --- |
| **Rolagem** | Velocidade (linhas/min) **ou duração por música (mm:ss)**, passo de ajuste, contagem regressiva, partida suave, pausar entre músicas, repetir |
| **Texto** | Linhas visíveis na tela, mín. de caracteres por linha (celular), espaçamento, espaço entre estrofes, fonte, negrito, MAIÚSCULAS, contorno, espaçamento de letras, largura, alinhamento, títulos |
| **Cores** | Usar cores do PDF, contraste automático, fundo, cor do “preto”, **legenda por cor** (nomear, trocar cor, esmaecer ou ocultar uma voz) |
| **Tela** | Marcador de leitura (seta, linha, faixa), posição e cor, esmaecer linhas lidas, degradê nas bordas, **espelhar** horizontal/vertical, barra de progresso, relógio, cronômetro/tempo restante, manter tela acesa |
| **Músicas** | Lista de músicas com salto rápido e duração de cada uma |
| **Presets** | Jornal, Coral/Cantata, Palco, Papel, Espelho + presets próprios; exportar/importar configurações |

### Atalhos de teclado (funcionam com pedais/controles Bluetooth)
`Espaço` play/pausa · `↑/↓` velocidade · `←/→` linha · `PgUp/PgDn` estrofe · `N/P` música ·
`1–9` ir para música · `Home/End` · `+/−` linhas na tela · `M/V` espelhar · `F` tela cheia ·
`R` zera cronômetro · `H` oculta controles · `Esc` sai.

No celular: toque para pausar/continuar, arraste para ajustar a posição.

### Janela de exibição (segundo monitor / projetor / vidro)
Em **Janela de exibição ↗** abre-se uma janela só com o texto, sincronizada com a tela
de controle (mesmo navegador/computador). Arraste-a para o outro monitor e pressione `F`.
`M` nessa janela espelha só a exibição (útil para o vidro do teleprompter).

### Importar texto (.txt)
Linha em branco = nova estrofe, `# Título` = nova música, `[#ff9300]trecho[/]` = cor.

## Desenvolvimento

```bash
npm install
npm run dev      # servidor local
npm run build    # gera dist/
```

Stack: Vite + TypeScript (sem framework) + [pdf.js](https://mozilla.github.io/pdf.js/).
Funciona offline após a primeira visita (PWA, pode ser “instalado” na tela inicial do celular).

### Deploy
O workflow `.github/workflows/deploy.yml` publica no GitHub Pages a cada push na `main`
(em *Settings → Pages*, selecione **Source: GitHub Actions**).
