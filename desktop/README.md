# Painel Técnico Landmensure

No Windows, execute **Abrir-Landmensure.cmd** na pasta `desktop`. O painel abre no navegador padrão. Se preferir o terminal, execute `node desktop/server.mjs` na raiz e abra o endereço exibido, normalmente `http://127.0.0.1:4173`. O servidor escuta apenas no próprio computador. Use Ctrl+C para encerrá-lo.

O painel abre com um levantamento fictício. Para revisar um projeto real, exporte um backup JSON no Android e use **Abrir backup do celular**. A leitura é local e não envia o arquivo ao servidor.

Para entrar com a conta do app, o servidor aceita somente a chave publicável do Supabase em `SUPABASE_PUBLISHABLE_KEY`, por variável de ambiente ou pelo `local.properties` já usado pelo Android. A consulta de revisões depende da migration `202611100001_survey_revisions.sql` no projeto Supabase e do envio de levantamentos pelo celular. O painel apenas consulta revisões e oferece a impressão ao Pro. Não exponha o servidor local na internet.
# Recuperação de senha

Para publicar a demonstração pessoal na Vercel, importe a raiz do repositório e defina `SUPABASE_PUBLISHABLE_KEY` com a chave publicável do projeto. A configuração da Vercel gera os arquivos estáticos do painel em `dist`.

Na demonstração em HTTPS, use o modelo padrão **Reset password** do Supabase. Adicione a URL HTTPS exata do painel em **Authentication → URL Configuration → Redirect URLs**. Peça a recuperação usando um e-mail da equipe do projeto Supabase e abra o link recebido na mesma aba em que fez o pedido.

O fluxo local por código requer um modelo personalizado em **Authentication → Emails → Reset password**, por exemplo:

```html
<p>Seu código para redefinir a senha do Landmensure é <strong>{{ .Token }}</strong>.</p>
<p>Informe esse código na tela de recuperação. Se não solicitou a alteração, ignore este e-mail.</p>
```

No painel, abra **Entrar → Esqueci minha senha**. Informe o e-mail, copie o código recebido e escolha uma nova senha. Depois, entre com a nova senha no painel ou no Android. O fluxo por código dispensa redirecionamento pelo e-mail.
