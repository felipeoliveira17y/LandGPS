# GPS Landmensure

Aplicativo Android para apoiar levantamentos de campo com GPS/GNSS. Este README apresenta as funções que já faziam parte do aplicativo e as melhorias incorporadas posteriormente durante o estágio.

## Funcionalidades que o aplicativo já possuía

- Exibição da posição GPS e coleta de pontos para um levantamento.
- Visualização dos pontos em mapa e imagem de satélite.
- Organização dos pontos em uma tabela com coordenadas e informações entre vértices.
- Geração de polígono a partir dos pontos e cálculo de área e perímetro.
- Salvamento e abertura de levantamentos.
- Exportação de dados e geração do memorial do levantamento.

## Melhorias incorporadas depois

### Coleta e informações GNSS

- Painel de posição em tempo real com coordenadas geográficas, UTM, acurácia estimada e estado da recepção.
- Exibição de satélites visíveis e usados, além de HDOP e PDOP quando informados pelo aparelho.
- Tela dedicada à consulta das constelações, frequências e bandas GNSS disponíveis.
- Modo **Ponto ajustado**, com ocupação de 120 segundos, filtragem de leituras discrepantes e apresentação de indicadores estatísticos da coleta.
- Identificação da acurácia do Android como estimativa, distinguindo-a dos indicadores calculados pelo modo Ponto ajustado.

### Organização e proteção dos levantamentos

- Separação dos comandos em quatro grupos: **Coleta e GNSS**, **Mapa e geometria**, **Levantamentos** e **Exportar e imprimir**.
- Salvamento automático do rascunho e recuperação ao reabrir o aplicativo.
- Edição dos nomes dos vértices, com atualização dos rótulos na tabela, no mapa e nos documentos gerados.
- Exportação e restauração de cópias de segurança em JSON.
- Salvamento dos arquivos na pasta **Downloads/GPS Landmensure**, usando o armazenamento do Android.

### Interface e experiência de uso

- Atualização da identidade visual, com hierarquia mais clara para títulos, cartões, campos e botões.
- Substituição dos emojis por ícones vetoriais SVG e indicadores de estado mais discretos.
- Inclusão dos temas claro e escuro e de um painel de **Definições** para escolher coleta padrão, mapa inicial e aparência.
- Ajuste da área segura para respeitar as barras de status e navegação do Android.
- Reserva nativa das áreas superior e inferior do sistema para evitar que a barra do aplicativo fique sob os indicadores do Android.
- Adaptação do layout à largura e à orientação da tela, incluindo celulares e telas maiores.
- Barra superior com acesso às definições e navegação em abas para separar **GNSS** de **Memorial KML**.
- Integração do módulo de cálculo de área e memorial por KML, com seleção de arquivos e impressão no Android.
- Centralização inicial do mapa na primeira posição GNSS válida recebida pelo aparelho.
- Padronização visual do Memorial KML com a identidade do app e aumento de textos, campos e botões para facilitar o uso no celular.
- Faixa de redes sociais e contato disponível também na tela GNSS, com abertura dos links no aplicativo adequado.

## Objetivo das melhorias

As mudanças ampliam a clareza das informações GNSS, facilitam o acesso às ações de campo e ajudam a proteger os dados coletados, preservando a função principal do GPS Landmensure: apoiar a coleta, a visualização e a organização de pontos de levantamentos.
