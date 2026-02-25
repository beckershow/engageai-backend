import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Running demo seed...')

  // ─── 4 Trainings ──────────────────────────────────────────────────────────

  const trainingsData = [
    {
      title: 'Comunicação Assertiva no Trabalho',
      description: 'Aprenda a se comunicar de forma clara, objetiva e respeitosa no ambiente profissional, melhorando seus relacionamentos e resultados.',
      primaryColor: '#3B82F6',
      contentOrigin: 'texto' as const,
      contentText: `# Comunicação Assertiva no Trabalho

A comunicação assertiva é a capacidade de expressar pensamentos, sentimentos e necessidades de forma direta, honesta e apropriada, sem ser agressivo ou passivo.

## Por que é importante?

Uma comunicação eficaz no trabalho:
- Reduz conflitos e mal-entendidos
- Aumenta a produtividade e colaboração
- Fortalece relacionamentos profissionais
- Melhora o clima organizacional

## Pilares da Comunicação Assertiva

### 1. Clareza
Seja objetivo e direto. Evite rodeios e ambiguidades. Use frases curtas e linguagem acessível.

### 2. Escuta Ativa
Preste atenção genuína ao interlocutor. Faça perguntas para confirmar o entendimento. Evite interrupções.

### 3. Linguagem Não-Verbal
Mantenha contato visual adequado. Adote postura aberta e receptiva. Tome cuidado com o tom de voz.

### 4. Feedback Construtivo
Foque no comportamento, não na pessoa. Seja específico e objetivo. Ofereça alternativas e soluções.

## Técnica do "Eu"
Use frases com "eu" para expressar sentimentos sem acusar: "Eu me sinto sobrecarregado quando..." em vez de "Você sempre me sobrecarrega..."

## Dicas Práticas
- Prepare-se antes de conversas difíceis
- Escolha o momento e local adequados
- Mantenha a calma e o respeito
- Confirme o entendimento mútuo ao final`,
      audienceType: 'todo_time' as const,
      rewardXP: 80,
      rewardStars: 20,
      questions: [
        {
          question: 'O que melhor define comunicação assertiva?',
          type: 'multipla_escolha' as const,
          options: ['Impor opiniões sem ouvir o outro', 'Expressar pensamentos de forma direta, honesta e respeitosa', 'Evitar conflitos a qualquer custo concordando com tudo', 'Ser agressivo para demonstrar confiança'],
          correctOption: 1,
          order: 0,
        },
        {
          question: 'Qual é o principal benefício da escuta ativa?',
          type: 'multipla_escolha' as const,
          options: ['Falar mais rápido que o interlocutor', 'Confirmar o entendimento e reduzir mal-entendidos', 'Parecer mais inteligente na conversa', 'Ganhar mais tempo para pensar nas respostas'],
          correctOption: 1,
          order: 1,
        },
        {
          question: 'A técnica do "Eu" serve para:',
          type: 'multipla_escolha' as const,
          options: ['Focar nos erros dos outros', 'Expressar sentimentos sem acusar diretamente a outra pessoa', 'Mostrar autoridade na conversa', 'Evitar assumir responsabilidade'],
          correctOption: 1,
          order: 2,
        },
      ],
    },
    {
      title: 'Bem-Estar e Saúde Mental',
      description: 'Estratégias práticas para cuidar da sua saúde mental, gerenciar o estresse e cultivar equilíbrio entre vida pessoal e profissional.',
      primaryColor: '#10B981',
      contentOrigin: 'texto' as const,
      contentText: `# Bem-Estar e Saúde Mental no Trabalho

A saúde mental é tão importante quanto a saúde física. Cuidar do seu bem-estar psicológico é fundamental para uma vida plena e produtiva.

## Sinais de Alerta

Fique atento a:
- Dificuldade de concentração persistente
- Irritabilidade ou mudanças de humor
- Fadiga excessiva mesmo após descanso
- Ansiedade frequente ou sentimentos de desesperança
- Isolamento social

## Estratégias de Bem-Estar

### Mindfulness e Atenção Plena
Dedique 10 minutos diários à meditação ou respiração consciente. Foque no momento presente, sem julgamentos.

### Gerenciamento do Estresse
- Identifique suas fontes de estresse
- Estabeleça prioridades e limites
- Aprenda a dizer "não" quando necessário
- Use técnicas de relaxamento (respiração 4-7-8, relaxamento muscular progressivo)

### Equilíbrio Trabalho-Vida
- Defina horários claros para trabalho e descanso
- Reserve tempo para hobbies e atividades prazerosas
- Mantenha conexões sociais significativas
- Faça pausas regulares durante o trabalho

### Hábitos Saudáveis
- Durma 7-9 horas por noite
- Pratique atividade física regularmente
- Alimente-se bem e hidrate-se
- Limite o consumo de álcool e cafeína

## Recursos de Apoio
Não hesite em buscar ajuda profissional quando necessário. Psicólogos, psiquiatras e programas de apoio ao colaborador estão disponíveis para você.`,
      audienceType: 'todo_time' as const,
      rewardXP: 60,
      rewardStars: 15,
      questions: [
        {
          question: 'Descreva uma situação em que você aplicou ou poderia aplicar técnicas de mindfulness no trabalho e qual foi ou seria o impacto.',
          type: 'descritiva' as const,
          options: [],
          correctOption: null,
          order: 0,
        },
        {
          question: 'Como você estabelece limites saudáveis entre trabalho e vida pessoal? Quais desafios enfrenta e o que poderia melhorar?',
          type: 'descritiva' as const,
          options: [],
          correctOption: null,
          order: 1,
        },
      ],
    },
    {
      title: 'Inglês para Negócios — Básico',
      description: 'Fundamentos do inglês corporativo: vocabulário essencial, estruturas de e-mail, reuniões e apresentações profissionais.',
      primaryColor: '#F59E0B',
      contentOrigin: 'texto' as const,
      contentText: `# Inglês para Negócios — Básico

O inglês é a língua franca dos negócios internacionais. Dominar o inglês corporativo abre portas e amplia suas oportunidades profissionais.

## Vocabulário Essencial

### Reuniões (Meetings)
- **Agenda** — pauta da reunião
- **Action items** — tarefas a serem realizadas
- **Follow-up** — acompanhamento posterior
- **Stakeholders** — partes interessadas
- **Deadline** — prazo final
- **Deliverable** — entrega/produto final

### E-mails Profissionais
- **Dear [Name]** — abertura formal
- **I hope this email finds you well** — saudação padrão
- **As per our conversation** — conforme nossa conversa
- **Please find attached** — segue em anexo
- **Looking forward to hearing from you** — aguardo seu retorno
- **Best regards / Sincerely** — encerramento formal

### Apresentações
- **To begin with** — para começar
- **Moving on to** — passando para
- **To summarize** — para resumir
- **In conclusion** — em conclusão
- **Q&A (Questions and Answers)** — perguntas e respostas

## Frases Úteis para Reuniões
- "Could you please repeat that?" — Você poderia repetir?
- "I'd like to add..." — Gostaria de acrescentar...
- "What do you mean by...?" — O que você quer dizer com...?
- "Can we take that offline?" — Podemos discutir isso depois?
- "Let's table this for now" — Vamos deixar isso para depois

## Dicas para Aprender
1. Assista séries e filmes em inglês com legenda em inglês
2. Ouça podcasts de negócios em inglês
3. Pratique escrita com e-mails diários
4. Use aplicativos como Duolingo e Anki para vocabulário`,
      audienceType: 'todo_time' as const,
      rewardXP: 100,
      rewardStars: 25,
      questions: [
        {
          question: 'Como se diz "prazo final" em inglês corporativo?',
          type: 'multipla_escolha' as const,
          options: ['Meeting', 'Deadline', 'Deliverable', 'Follow-up'],
          correctOption: 1,
          order: 0,
        },
        {
          question: 'Qual frase é adequada para encerrar um e-mail profissional em inglês?',
          type: 'multipla_escolha' as const,
          options: ['See ya!', 'Bye for now', 'Best regards', 'Ciao'],
          correctOption: 2,
          order: 1,
        },
        {
          question: 'O que significa "Let\'s take that offline" em uma reunião?',
          type: 'multipla_escolha' as const,
          options: ['Vamos desligar a câmera', 'Vamos discutir esse assunto fora da reunião', 'Precisamos de internet melhor', 'A reunião acabou'],
          correctOption: 1,
          order: 2,
        },
      ],
    },
    {
      title: 'Excel Avançado para Análise de Dados',
      description: 'Domine funções avançadas, tabelas dinâmicas, dashboards e automações no Excel para análise de dados profissional.',
      primaryColor: '#8B5CF6',
      contentOrigin: 'texto' as const,
      contentText: `# Excel Avançado para Análise de Dados

O Excel é uma das ferramentas mais poderosas e versáteis para análise de dados. Dominar seus recursos avançados pode transformar sua produtividade.

## Funções Avançadas Essenciais

### PROCV / XLOOKUP
\`=PROCV(valor; tabela; coluna; [exato])\` — Busca vertical em tabelas
\`=XLOOKUP(procurar; intervalo_busca; intervalo_retorno)\` — Versão moderna e mais flexível

### SE e Variantes
- \`=SE(condição; valor_verdadeiro; valor_falso)\`
- \`=SEERRO(fórmula; valor_se_erro)\`
- \`=SES(cond1; val1; cond2; val2; ...)\`

### Funções de Agregação
- \`=SOMASE(intervalo; critério; soma)\` — Soma condicional
- \`=CONT.SE(intervalo; critério)\` — Contagem condicional
- \`=MÉDIASE(intervalo; critério; média)\` — Média condicional

## Tabelas Dinâmicas (Pivot Tables)

Tabelas dinâmicas permitem resumir e analisar grandes volumes de dados rapidamente.

**Como criar:**
1. Selecione seus dados
2. Inserir → Tabela Dinâmica
3. Arraste campos para Linhas, Colunas, Valores e Filtros
4. Configure cálculos (soma, contagem, média, %)

## Dashboards Profissionais

### Princípios de Design
- Use no máximo 3-4 cores principais
- Hierarquia visual clara (título > subtítulo > dados)
- Consistência nos formatos e estilos
- Espaço em branco é seu aliado

### Tipos de Gráficos
- **Barras/Colunas** — comparações entre categorias
- **Linhas** — tendências ao longo do tempo
- **Pizza** — proporções (máximo 5-6 fatias)
- **Dispersão** — correlações entre variáveis

## Automação com Macros
Grave macros para automatizar tarefas repetitivas:
- Desenvolvedor → Gravar Macro
- Execute as ações desejadas
- Pare a gravação e atribua um atalho

## Power Query
Importe e transforme dados de múltiplas fontes:
- Dados → Obter Dados → De Arquivo/Web/Database
- Transforme, filtre e mescle tabelas
- Atualize com um clique`,
      audienceType: 'todo_time' as const,
      rewardXP: 120,
      rewardStars: 30,
      questions: [
        {
          question: 'Qual função do Excel é usada para buscar um valor em uma tabela verticalmente?',
          type: 'multipla_escolha' as const,
          options: ['SOMASE', 'CONT.SE', 'PROCV', 'MÉDIASE'],
          correctOption: 2,
          order: 0,
        },
        {
          question: 'Para que serve uma Tabela Dinâmica (Pivot Table)?',
          type: 'multipla_escolha' as const,
          options: ['Criar gráficos automaticamente', 'Resumir e analisar grandes volumes de dados', 'Proteger a planilha com senha', 'Formatar células condicionalmente'],
          correctOption: 1,
          order: 1,
        },
        {
          question: 'Qual tipo de gráfico é mais adequado para mostrar tendências ao longo do tempo?',
          type: 'multipla_escolha' as const,
          options: ['Pizza', 'Barras', 'Linhas', 'Dispersão'],
          correctOption: 2,
          order: 2,
        },
        {
          question: 'O que é o Power Query no Excel?',
          type: 'multipla_escolha' as const,
          options: ['Um tipo de macro para cálculos rápidos', 'Uma ferramenta para importar e transformar dados de múltiplas fontes', 'Um recurso de proteção de dados', 'Um plugin pago separado do Excel'],
          correctOption: 1,
          order: 3,
        },
      ],
    },
  ]

  for (const trainingData of trainingsData) {
    const { questions, ...training } = trainingData

    // Check if training already exists
    const existing = await prisma.training.findFirst({
      where: { title: training.title, deletedAt: null },
    })
    if (existing) {
      console.log(`⏭️  Training already exists: ${training.title}`)
      continue
    }

    const created = await prisma.training.create({
      data: {
        ...training,
        creatorId: '1',
        rewardsActive: true,
        questionsRequired: true,
        noAssessment: false,
      },
    })

    for (const q of questions) {
      await prisma.trainingQuestion.create({
        data: {
          trainingId: created.id,
          question: q.question,
          type: q.type,
          answerTypes: [q.type],
          options: q.options,
          correctOption: q.correctOption,
          order: q.order,
        },
      })
    }

    console.log(`✅ Created training: ${training.title}`)
  }

  // ─── 6 Notifications for Ana Carolina (user '3') ──────────────────────────

  const now = new Date()
  const notificationsData = [
    {
      userId: '3',
      type: 'survey_available' as const,
      title: 'Nova pesquisa disponível',
      message: 'Pesquisa de Satisfação Q4 2025 aguarda sua resposta',
      status: 'unread' as const,
      createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), // 1 day ago
    },
    {
      userId: '3',
      type: 'survey_available' as const,
      title: 'Nova pesquisa disponível',
      message: 'Pesquisa de Clima Organizacional está aberta',
      status: 'unread' as const,
      createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    },
    {
      userId: '3',
      type: 'system' as const,
      title: 'Novo treinamento disponível',
      message: 'Comunicação Assertiva no Trabalho foi publicado',
      status: 'unread' as const,
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), // 3 days ago
    },
    {
      userId: '3',
      type: 'system' as const,
      title: 'Novo treinamento disponível',
      message: 'Inglês para Negócios — Básico está disponível',
      status: 'unread' as const,
      createdAt: new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000), // 4 days ago
    },
    {
      userId: '3',
      type: 'system' as const,
      title: 'Nova recompensa adicionada',
      message: 'Day Off Extra agora disponível na loja',
      status: 'unread' as const,
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000), // 5 days ago
    },
    {
      userId: '3',
      type: 'feedback_received' as const,
      title: 'Você recebeu um feedback',
      message: 'Marina Oliveira enviou um reconhecimento para você',
      status: 'unread' as const,
      createdAt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), // 7 days ago
    },
  ]

  // Check if notifications already exist for this user
  const existingNotifications = await prisma.notification.count({
    where: { userId: '3' },
  })

  if (existingNotifications >= 6) {
    console.log('⏭️  Notifications already exist for Ana Carolina')
  } else {
    for (const notif of notificationsData) {
      await prisma.notification.create({ data: notif })
    }
    console.log(`✅ Created ${notificationsData.length} notifications for Ana Carolina`)
  }

  console.log('🎉 Demo seed completed!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
