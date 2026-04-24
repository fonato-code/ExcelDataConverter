# Fluxo ExcelConverter: Input → Preview → Output

## Modelo de dados

| Camada | Conteúdo |
|--------|----------|
| **Canónico** | `standardHeaders`, `standardRows`, `standardColumnKeys`, `standardRowKeys` — tabela editável em memória. |
| **Config** | `columnConfigs` (por coluna: visibilidade no output, filtros de vista, merge, fill, tipos SQL/Avro, etc.) e `rowConfigs` (linha visível no output). |
| **Vista Preview** | Filtros por coluna + pesquisa + ordenação por coluna (`filteredPreviewRows`) e paginação (`paginatedPreviewRows`). A paginação **não** altera dados, só o que se vê. |

## Ordem das linhas no output

- **Reordenar linhas** (arrastar ou subir/descer) altera a ordem na canónica → o export segue essa ordem.
- **Ordenar por coluna** no preview (ícone no cabeçalho) aplica a **mesma** ordenação às linhas exportadas (entre linhas incluídas no output), alinhada ao preview.
- Filtros de coluna e pesquisa **não** limitam o export por omissão: o output usa todas as linhas **activas** (não escondidas no output). A vista filtrada serve para navegação e para operações que declaram usar `filteredPreviewRows` (ex.: preenchimento em massa por coluna).

## Auto-cópia

Não existe: o resultado aparece no textarea do Output e a cópia é **manual** (botão).

## Acções → alcance

| Acção | Alvo principal |
|--------|----------------|
| Parser do input | Repõe a canónica a partir do texto (perde edições não guardadas no sentido de “reset” usar original parseado). |
| Editar célula / cabeçalho | Canónico |
| Esconder linha ou coluna no output | `rowConfigs` / `columnConfigs.enabled` — exclui do export |
| Ordenação coluna preview | Ordem usada no export (linhas seleccionadas para output) |
| Filtro coluna / pesquisa | Vista (e bulk fill / locale no menu da coluna) |
| Mesclar / dividir colunas | Tabela canónica completa; **mesclagem** junta valores pela **ordem visual** das colunas seleccionadas (esquerda → direita na grelha). |
| Reset preview | Volta `originalStandard*` |

## Desempenho

Com muitas linhas ou células, a barra de estado do preview pode mostrar um aviso. Use paginação no preview para reduzir nós no DOM.

## Ficheiros relevantes

- Lógica principal: `src/js/app.js`
- Parsers de entrada: `src/js/input-formats/*`
- Builders de saída: `src/js/output-formats/*`
