# Perfil canônico e critérios de triagem

## Fonte de verdade

Em execução, a única fonte do perfil do candidato é o registro autenticado na tabela D1 `profiles`. A função `canonicalizeProfile` converte esse registro para o formato usado pela triagem. O campo `updated_at` é a versão do perfil: qualquer análise gravada com uma versão diferente fica desatualizada.

`alexsandroProfilePreset()` é apenas um atalho de preenchimento inicial da tela. Ele não pode ser usado para avaliar vagas, gerar rascunhos ou completar competências ausentes.

Sem `mastered_skills` no perfil canônico, a triagem não produz veredito. A ação correta é solicitar o cadastro das competências; nunca assumir uma stack fixa ou usar memória de sessão.

## Decisão determinística

| Resultado | Regra |
| --- | --- |
| **BATE** (`✅`) | Nenhum bloqueador e nenhuma ressalva nos critérios avaliados. |
| **PROVÁVEL** (`🟡`) | Nenhum bloqueador estrutural, mas há item a confirmar ou preferência não conclusiva. |
| **NÃO BATE** (`🔴`) | Não há veto estrutural, porém o fit técnico falha ou há duas ou mais condições desfavoráveis. |
| **BLOQUEADA** (`❌`) | Um veto estrutural impede candidatura: stack principal incompatível, idioma obrigatório não cadastrado, senioridade/tipo de atuação bloqueados ou local/híbrido fora do limite. |

O rótulo **BLOQUEADA** integra o histórico como não aderente, com `blocker` explícito. Somente BATE e PROVÁVEL podem seguir, nas próximas histórias, à fila de candidatura e à geração de rascunho.

## Casos verificáveis

- Vaga remota C#/.NET, sem ressalvas: **BATE**.
- Vaga C#/.NET híbrida três dias por semana para perfil cujo máximo é dois: **BLOQUEADA** por geografia.
- Vaga que exige inglês ou espanhol avançado sem esse idioma cadastrado: **BLOQUEADA** por idioma.
- Vaga marcada com senioridade ou tipo de atuação bloqueado no perfil: **BLOQUEADA**.
- Vaga VBA + Access + SQL Server ou QA .NET Sênior configurada como exceção: não é bloqueada somente pela stack; os demais critérios continuam valendo.
- Vaga com requisitos técnicos parcialmente atendidos e sem veto: **PROVÁVEL** ou **NÃO BATE**, conforme os critérios desfavoráveis e ressalvas registrados nas linhas do veredito.
