# Instruções do projeto

- Depois de concluir e validar uma alteração solicitada, publique-a por padrão no ambiente de produção.
- A publicação deve ocorrer pelo GitHub Actions: faça commit e push para `main`, acompanhe o workflow `Validar e publicar o Radar` e confirme que o job `Publicar no Cloudflare` terminou com sucesso.
- Preserve alterações locais não relacionadas e nunca as inclua silenciosamente no commit.
- Se a publicação estiver bloqueada por testes, autenticação, conflito ou falha do workflow, não ignore o bloqueio: corrija-o quando estiver no escopo ou informe claramente o impedimento.

## Publicação com alterações locais pendentes

- Antes de editar e antes de publicar, registre `git status --short` e confirme a fonte de verdade do componente.
- Se houver alterações locais não relacionadas, publique a entrega a partir de um clone limpo ou `git worktree` separado e sincronizado. Leve para ele somente os arquivos validados.
- Não use o índice principal para misturar uma entrega com mudanças já preparadas. Um índice temporário é último recurso e requer verificar antes se não há processos Git concorrentes.
- Diante de um arquivo `.git/index.lock` ou de lock de índice em uso, não encerre processos Git nem remova locks sem confirmação explícita da pessoa usuária. Aguarde, identifique o processo ou use um clone/worktree novo.
- Não declare publicação concluída até confirmar commit, push e o resultado operacional aplicável; para extensões Chrome locais, informe também que o código enviado só entra em uso após recarregar a pasta no `chrome://extensions`.

## Trabalho concorrente e worktrees

- A existência de vários `git worktree` é esperada e não constitui bloqueio por si só: cada entrega deve permanecer isolada em sua própria branch/worktree.
- Antes de editar, integrar ou publicar, verifique `git status --short`, `git worktree list --porcelain` e a presença de `.git/*.lock`. Considere a cópia principal insegura para publicação quando estiver suja.
- Nunca faça commit, `push`, merge, rebase, limpeza (`git gc`/`git worktree prune`) ou alteração de arquivos compartilhados a partir de uma cópia com trabalho alheio pendente. Use um clone ou worktree limpo e leve somente os arquivos da entrega validada.
- Não remova locks nem interrompa processos Git/Node de outras tarefas sem autorização explícita. Se houver concorrência, registre o bloqueio e aguarde ou crie um ambiente isolado.
- Depois de confirmar commit, push e publicação em produção, remova o clone ou worktree temporário criado exclusivamente para aquela publicação, desde que esteja limpo. Nunca remova a cópia principal, worktrees de trabalho ativo ou qualquer diretório com alterações pendentes.

## Padrões operacionais permanentes

- Registre no card correspondente do Notion toda correção, entrega funcional ou incidente: contexto, causa, evidências, correção aplicada, validação e próximo passo.
- Antes de encerrar uma entrega, execute validação proporcional ao risco. Para mudanças funcionais, inclua os testes afetados; para falhas de automação, registre também a evidência operacional observada.
- Para qualquer alteração funcional na extensão Chrome, atualize a versão do manifesto, os testes e a documentação de uso antes da entrega. Indique a pasta exata que deve ser recarregada no Chrome quando aplicável.
- Automação de coleta e triagem deve manter rastreabilidade: informar última execução, próxima execução, totais, falhas e motivo acionável quando não houver próximo agendamento.
- Não criar, enviar ou efetivar candidaturas, e-mails ou rascunhos no Gmail de forma automática sem confirmação explícita da pessoa usuária para esse comportamento.
- Quando houver múltiplas cópias de um componente, confirme e documente qual é a fonte de verdade antes de alterá-lo; não misture alterações de cópias legadas com a versão ativa.
