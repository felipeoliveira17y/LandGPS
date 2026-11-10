# Painel Técnico Landmensure

No Windows, execute **Abrir-Landmensure.cmd** na pasta `desktop`. O painel abre no navegador padrão. Se preferir o terminal, execute `node desktop/server.mjs` na raiz e abra o endereço exibido, normalmente `http://127.0.0.1:4173`. O servidor escuta apenas no próprio computador. Use Ctrl+C para encerrá-lo.

O painel abre com um levantamento fictício. Para revisar um projeto real, exporte um backup JSON no Android e use **Abrir backup do celular**. A leitura é local e não envia o arquivo ao servidor.

Para entrar com a conta do app, o servidor aceita somente a chave publicável do Supabase em `SUPABASE_PUBLISHABLE_KEY`, por variável de ambiente ou pelo `local.properties` já usado pelo Android. A consulta de revisões depende da migration `202611100001_survey_revisions.sql` no projeto Supabase e do envio de levantamentos pelo celular. O painel apenas consulta revisões e oferece a impressão ao Pro. Não exponha o servidor local na internet.
