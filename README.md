# PORRINH4

PWA responsivo para Android e outros celulares. Até 10 participantes (incluindo o anfitrião), escolhem 0–3 (números repetidos são permitidos), reservam palpites únicos de 0 até 3 × quantidade de jogadores e veem o resultado após uma contagem de 5 segundos.

## Experimentar sem configurar nada

Publique/abra o site em HTTPS, toque em **Jogar agora — sem configurar** e jogue uma rodada de treino com três participantes fictícios. O treino roda localmente e não sincroniza com outros aparelhos.

## Configuração online simplificada com Supabase

1. No projeto Supabase, abra **SQL Editor → New query**.
2. Abra `supabase-setup.sql`, copie todo o conteúdo, cole na consulta e aperte **Run**.
3. A publicação oficial já inclui a URL e a chave publicável do projeto. Depois de atualizar o site, cada aparelho conecta automaticamente.
4. O anfitrião cria uma sala e compartilha o código/link. Os demais informam o nome e o código para entrar.

O SQL cria as tabelas, as permissões de leitura necessárias e a função de jogo; os palpites ficam em um schema privado e só são publicados no resultado. A chave publicável é própria para código no navegador. Nunca cole uma `service_role`, chave secreta ou senha do banco no app.

## Instalar em Android

Abra o site HTTPS no Chrome. Use o menu ⋮ → **Instalar app** (ou **Adicionar à tela inicial**, dependendo do aparelho). O app foi feito para telas pequenas e funciona em navegadores Android atuais; conexão com a internet é necessária para salas Supabase.

## Publicar

Hospede o conteúdo desta pasta em HTTPS, por exemplo no GitHub Pages. Se publicar numa subpasta, mantenha juntos `index.html`, `app.js`, `style.css`, `manifest.webmanifest`, `sw.js`, `icon.svg` e `supabase-setup.sql`.

## Limite de segurança

O SQL guarda escolhas em tabela privada e o cliente não consegue consultá-las diretamente. O identificador de jogador é anônimo e local ao aparelho; este protótipo não substitui autenticação de conta para um jogo competitivo com alto risco de abuso.

