# Instruções do projeto

- Depois de concluir e validar uma alteração solicitada, publique-a por padrão no ambiente de produção.
- A publicação deve ocorrer pelo GitHub Actions: faça commit e push para `main`, acompanhe o workflow `Validar e publicar o Radar` e confirme que o job `Publicar no Cloudflare` terminou com sucesso.
- Preserve alterações locais não relacionadas e nunca as inclua silenciosamente no commit.
- Se a publicação estiver bloqueada por testes, autenticação, conflito ou falha do workflow, não ignore o bloqueio: corrija-o quando estiver no escopo ou informe claramente o impedimento.

## Padrões operacionais permanentes

- Registre no card correspondente do Notion toda correção, entrega funcional ou incidente: contexto, causa, evidências, correção aplicada, validação e próximo passo.
- Antes de encerrar uma entrega, execute validação proporcional ao risco. Para mudanças funcionais, inclua os testes afetados; para falhas de automação, registre também a evidência operacional observada.
- Para qualquer alteração funcional na extensão Chrome, atualize a versão do manifesto, os testes e a documentação de uso antes da entrega. Indique a pasta exata que deve ser recarregada no Chrome quando aplicável.
- Automação de coleta e triagem deve manter rastreabilidade: informar última execução, próxima execução, totais, falhas e motivo acionável quando não houver próximo agendamento.
- Não criar, enviar ou efetivar candidaturas, e-mails ou rascunhos no Gmail de forma automática sem confirmação explícita da pessoa usuária para esse comportamento.
- Quando houver múltiplas cópias de um componente, confirme e documente qual é a fonte de verdade antes de alterá-lo; não misture alterações de cópias legadas com a versão ativa.
