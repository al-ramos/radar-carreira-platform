# Instruções do projeto

- Depois de concluir e validar uma alteração solicitada, publique-a por padrão no ambiente de produção.
- A publicação deve ocorrer pelo GitHub Actions: faça commit e push para `main`, acompanhe o workflow `Validar e publicar o Radar` e confirme que o job `Publicar no Cloudflare` terminou com sucesso.
- Preserve alterações locais não relacionadas e nunca as inclua silenciosamente no commit.
- Se a publicação estiver bloqueada por testes, autenticação, conflito ou falha do workflow, não ignore o bloqueio: corrija-o quando estiver no escopo ou informe claramente o impedimento.
