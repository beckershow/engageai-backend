import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

const DEFAULT_PASSWORD = 'engageai123'

async function hashPwd(pwd: string) {
  return bcrypt.hash(pwd, 12)
}

async function main() {
  console.log('🌱 Seeding database...')

  const hash = await hashPwd(DEFAULT_PASSWORD)

  // ─── Users (all 45 from frontend mock) ────────────────────────────────────

  const usersData = [
    // Super Admin
    { id: '1', nome: 'Carlos Eduardo Santos', email: 'carlos.eduardo@engageai.com', cargo: 'Diretor de RH', departamento: 'Recursos Humanos', role: 'super_admin' as const, nivel: 10, xp: 5000, xpProximo: 6000, estrelas: 500, avatar: '/Admin_EngageAI.jpg' },

    // Gestores
    { id: '2', nome: 'Marina Oliveira', email: 'marina.oliveira@engageai.com', cargo: 'Gerente de Marketing', departamento: 'Time Criativo', role: 'gestor' as const, nivel: 7, xp: 3200, xpProximo: 4000, estrelas: 280, managerId: '1', avatar: '/Gestora_EngageAI.jpg' },
    { id: '6', nome: 'Lucas Andrade', email: 'lucas.andrade@engageai.com', cargo: 'Gerente de Vendas', departamento: 'Comercial', role: 'gestor' as const, nivel: 8, xp: 3800, xpProximo: 4500, estrelas: 320, managerId: '1', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=LucasAndrade&size=128' },
    { id: '7', nome: 'Fernanda Costa', email: 'fernanda.costa@engageai.com', cargo: 'Gerente de Tecnologia', departamento: 'TI', role: 'gestor' as const, nivel: 9, xp: 4200, xpProximo: 5000, estrelas: 380, managerId: '1', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=FernandaCosta&size=128' },
    { id: '8', nome: 'Rafael Lima', email: 'rafael.lima@engageai.com', cargo: 'Gerente de Operações', departamento: 'Operações', role: 'gestor' as const, nivel: 7, xp: 3100, xpProximo: 4000, estrelas: 260, managerId: '1', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=RafaelLima&size=128' },
    { id: '9', nome: 'Bruno Martins', email: 'bruno.martins@engageai.com', cargo: 'Gerente de Produtos', departamento: 'Produto', role: 'gestor' as const, nivel: 8, xp: 3600, xpProximo: 4500, estrelas: 300, managerId: '1', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=BrunoMartins&size=128' },
    { id: '10', nome: 'Juliana Santos', email: 'juliana.santos@engageai.com', cargo: 'Gerente de Atendimento', departamento: 'Customer Success', role: 'gestor' as const, nivel: 6, xp: 2800, xpProximo: 3500, estrelas: 240, managerId: '1', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=JulianaSantos&size=128' },

    // Time Criativo (manager: 2)
    { id: '3', nome: 'Ana Carolina Silva', email: 'ana.carolina@engageai.com', cargo: 'Analista de Marketing', departamento: 'Time Criativo', role: 'colaborador' as const, nivel: 4, xp: 1200, xpProximo: 2300, estrelas: 150, managerId: '2', avatar: '/Colaboradora_EngageAI.jpg' },
    { id: '4', nome: 'João Silva', email: 'joao.silva@engageai.com', cargo: 'Designer', departamento: 'Time Criativo', role: 'colaborador' as const, nivel: 5, xp: 2100, xpProximo: 3000, estrelas: 180, managerId: '2', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=JoaoSilva&size=128' },
    { id: '5', nome: 'Pedro Costa', email: 'pedro.costa@engageai.com', cargo: 'Copywriter', departamento: 'Time Criativo', role: 'colaborador' as const, nivel: 3, xp: 800, xpProximo: 1500, estrelas: 120, managerId: '2', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=PedroCosta&size=128' },

    // Comercial (manager: 6)
    { id: '11', nome: 'Rodrigo Ferreira', email: 'rodrigo.ferreira@engageai.com', cargo: 'Executivo de Vendas', departamento: 'Comercial', role: 'colaborador' as const, nivel: 5, xp: 2200, xpProximo: 3000, estrelas: 190, managerId: '6', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=RodrigoFerreira&size=128' },
    { id: '12', nome: 'Camila Alves', email: 'camila.alves@engageai.com', cargo: 'Executiva de Vendas', departamento: 'Comercial', role: 'colaborador' as const, nivel: 6, xp: 2600, xpProximo: 3500, estrelas: 210, managerId: '6', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=CamilaAlves&size=128' },
    { id: '13', nome: 'Thiago Souza', email: 'thiago.souza@engageai.com', cargo: 'Analista de Vendas', departamento: 'Comercial', role: 'colaborador' as const, nivel: 4, xp: 1400, xpProximo: 2300, estrelas: 140, managerId: '6', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=ThiagoSouza&size=128' },
    { id: '14', nome: 'Beatriz Rocha', email: 'beatriz.rocha@engageai.com', cargo: 'SDR', departamento: 'Comercial', role: 'colaborador' as const, nivel: 3, xp: 900, xpProximo: 1500, estrelas: 110, managerId: '6', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=BeatrizRocha&size=128' },
    { id: '15', nome: 'Felipe Cardoso', email: 'felipe.cardoso@engageai.com', cargo: 'SDR', departamento: 'Comercial', role: 'colaborador' as const, nivel: 3, xp: 850, xpProximo: 1500, estrelas: 105, managerId: '6', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=FelipeCardoso&size=128' },
    { id: '16', nome: 'Larissa Mendes', email: 'larissa.mendes@engageai.com', cargo: 'Executiva de Vendas', departamento: 'Comercial', role: 'colaborador' as const, nivel: 5, xp: 2300, xpProximo: 3000, estrelas: 195, managerId: '6', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=LarissaMendes&size=128' },
    { id: '17', nome: 'Guilherme Pinto', email: 'guilherme.pinto@engageai.com', cargo: 'Analista de Vendas', departamento: 'Comercial', role: 'colaborador' as const, nivel: 4, xp: 1500, xpProximo: 2300, estrelas: 155, managerId: '6', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=GuilhermePinto&size=128' },

    // TI (manager: 7)
    { id: '18', nome: 'Daniel Ribeiro', email: 'daniel.ribeiro@engageai.com', cargo: 'Tech Lead', departamento: 'TI', role: 'colaborador' as const, nivel: 7, xp: 3300, xpProximo: 4000, estrelas: 285, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=DanielRibeiro&size=128' },
    { id: '19', nome: 'Aline Nascimento', email: 'aline.nascimento@engageai.com', cargo: 'Desenvolvedora Full Stack', departamento: 'TI', role: 'colaborador' as const, nivel: 6, xp: 2700, xpProximo: 3500, estrelas: 220, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=AlineNascimento&size=128' },
    { id: '20', nome: 'Marcelo Castro', email: 'marcelo.castro@engageai.com', cargo: 'Desenvolvedor Backend', departamento: 'TI', role: 'colaborador' as const, nivel: 6, xp: 2650, xpProximo: 3500, estrelas: 215, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=MarceloCastro&size=128' },
    { id: '21', nome: 'Patrícia Gomes', email: 'patricia.gomes@engageai.com', cargo: 'Desenvolvedora Frontend', departamento: 'TI', role: 'colaborador' as const, nivel: 5, xp: 2400, xpProximo: 3000, estrelas: 200, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=PatriciaGomes&size=128' },
    { id: '22', nome: 'Vinícius Barros', email: 'vinicius.barros@engageai.com', cargo: 'DevOps Engineer', departamento: 'TI', role: 'colaborador' as const, nivel: 7, xp: 3250, xpProximo: 4000, estrelas: 280, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=ViniciusBarros&size=128' },
    { id: '23', nome: 'Natália Teixeira', email: 'natalia.teixeira@engageai.com', cargo: 'QA Engineer', departamento: 'TI', role: 'colaborador' as const, nivel: 5, xp: 2350, xpProximo: 3000, estrelas: 195, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=NataliaTeixeira&size=128' },
    { id: '24', nome: 'Roberto Dias', email: 'roberto.dias@engageai.com', cargo: 'Analista de Dados', departamento: 'TI', role: 'colaborador' as const, nivel: 6, xp: 2550, xpProximo: 3500, estrelas: 210, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=RobertoDias&size=128' },
    { id: '25', nome: 'Gabriela Moura', email: 'gabriela.moura@engageai.com', cargo: 'UX Designer', departamento: 'TI', role: 'colaborador' as const, nivel: 5, xp: 2150, xpProximo: 3000, estrelas: 185, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=GabrielaMoura&size=128' },
    { id: '26', nome: 'Henrique Azevedo', email: 'henrique.azevedo@engageai.com', cargo: 'Desenvolvedor Mobile', departamento: 'TI', role: 'colaborador' as const, nivel: 6, xp: 2600, xpProximo: 3500, estrelas: 215, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=HenriqueAzevedo&size=128' },
    { id: '27', nome: 'Renata Freitas', email: 'renata.freitas@engageai.com', cargo: 'Analista de Infraestrutura', departamento: 'TI', role: 'colaborador' as const, nivel: 4, xp: 1800, xpProximo: 2300, estrelas: 165, managerId: '7', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=RenataFreitas&size=128' },

    // Operações (manager: 8)
    { id: '28', nome: 'Leonardo Araújo', email: 'leonardo.araujo@engageai.com', cargo: 'Coordenador de Operações', departamento: 'Operações', role: 'colaborador' as const, nivel: 6, xp: 2500, xpProximo: 3500, estrelas: 205, managerId: '8', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=LeonardoAraujo&size=128' },
    { id: '29', nome: 'Tatiana Lopes', email: 'tatiana.lopes@engageai.com', cargo: 'Analista de Processos', departamento: 'Operações', role: 'colaborador' as const, nivel: 5, xp: 2100, xpProximo: 3000, estrelas: 180, managerId: '8', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=TatianaLopes&size=128' },
    { id: '30', nome: 'André Correia', email: 'andre.correia@engageai.com', cargo: 'Analista de Logística', departamento: 'Operações', role: 'colaborador' as const, nivel: 4, xp: 1650, xpProximo: 2300, estrelas: 160, managerId: '8', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=AndreCorreia&size=128' },
    { id: '31', nome: 'Carla Martins', email: 'carla.martins@engageai.com', cargo: 'Assistente Operacional', departamento: 'Operações', role: 'colaborador' as const, nivel: 3, xp: 950, xpProximo: 1500, estrelas: 115, managerId: '8', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=CarlaMartins&size=128' },
    { id: '32', nome: 'Fábio Pereira', email: 'fabio.pereira@engageai.com', cargo: 'Analista de Qualidade', departamento: 'Operações', role: 'colaborador' as const, nivel: 5, xp: 2250, xpProximo: 3000, estrelas: 190, managerId: '8', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=FabioPereira&size=128' },
    { id: '33', nome: 'Vanessa Duarte', email: 'vanessa.duarte@engageai.com', cargo: 'Analista de Melhoria Contínua', departamento: 'Operações', role: 'colaborador' as const, nivel: 5, xp: 2200, xpProximo: 3000, estrelas: 185, managerId: '8', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=VanessaDuarte&size=128' },

    // Produto (manager: 9)
    { id: '34', nome: 'Ricardo Campos', email: 'ricardo.campos@engageai.com', cargo: 'Product Owner', departamento: 'Produto', role: 'colaborador' as const, nivel: 7, xp: 3150, xpProximo: 4000, estrelas: 275, managerId: '9', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=RicardoCampos&size=128' },
    { id: '35', nome: 'Isabela Rodrigues', email: 'isabela.rodrigues@engageai.com', cargo: 'Product Manager', departamento: 'Produto', role: 'colaborador' as const, nivel: 6, xp: 2750, xpProximo: 3500, estrelas: 225, managerId: '9', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=IsabelaRodrigues&size=128' },
    { id: '36', nome: 'Gustavo Farias', email: 'gustavo.farias@engageai.com', cargo: 'Product Designer', departamento: 'Produto', role: 'colaborador' as const, nivel: 6, xp: 2650, xpProximo: 3500, estrelas: 220, managerId: '9', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=GustavoFarias&size=128' },
    { id: '37', nome: 'Priscila Monteiro', email: 'priscila.monteiro@engageai.com', cargo: 'UX Researcher', departamento: 'Produto', role: 'colaborador' as const, nivel: 5, xp: 2300, xpProximo: 3000, estrelas: 195, managerId: '9', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=PriscilaMonteriro&size=128' },
    { id: '38', nome: 'Eduardo Batista', email: 'eduardo.batista@engageai.com', cargo: 'Analista de Produto', departamento: 'Produto', role: 'colaborador' as const, nivel: 4, xp: 1750, xpProximo: 2300, estrelas: 165, managerId: '9', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=EduardoBatista&size=128' },
    { id: '39', nome: 'Letícia Ramos', email: 'leticia.ramos@engageai.com', cargo: 'Product Marketing', departamento: 'Produto', role: 'colaborador' as const, nivel: 5, xp: 2400, xpProximo: 3000, estrelas: 200, managerId: '9', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=LeticiaRamos&size=128' },
    { id: '40', nome: 'Marcos Vieira', email: 'marcos.vieira@engageai.com', cargo: 'Business Analyst', departamento: 'Produto', role: 'colaborador' as const, nivel: 5, xp: 2150, xpProximo: 3000, estrelas: 185, managerId: '9', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=MarcosVieira&size=128' },

    // Customer Success (manager: 10)
    { id: '41', nome: 'Cristiane Nunes', email: 'cristiane.nunes@engageai.com', cargo: 'Customer Success Manager', departamento: 'Customer Success', role: 'colaborador' as const, nivel: 6, xp: 2550, xpProximo: 3500, estrelas: 210, managerId: '10', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=CristianeNunes&size=128' },
    { id: '42', nome: 'Paulo Santana', email: 'paulo.santana@engageai.com', cargo: 'Customer Success Analyst', departamento: 'Customer Success', role: 'colaborador' as const, nivel: 4, xp: 1600, xpProximo: 2300, estrelas: 155, managerId: '10', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=PauloSantana&size=128' },
    { id: '43', nome: 'Amanda Tavares', email: 'amanda.tavares@engageai.com', cargo: 'Customer Support', departamento: 'Customer Success', role: 'colaborador' as const, nivel: 4, xp: 1450, xpProximo: 2300, estrelas: 145, managerId: '10', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=AmandaTavares&size=128' },
    { id: '44', nome: 'Diego Brito', email: 'diego.brito@engageai.com', cargo: 'Customer Support', departamento: 'Customer Success', role: 'colaborador' as const, nivel: 3, xp: 1050, xpProximo: 1500, estrelas: 125, managerId: '10', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=DiegoBrito&size=128' },
    { id: '45', nome: 'Simone Carvalho', email: 'simone.carvalho@engageai.com', cargo: 'Onboarding Specialist', departamento: 'Customer Success', role: 'colaborador' as const, nivel: 5, xp: 2050, xpProximo: 3000, estrelas: 175, managerId: '10', avatar: 'https://api.dicebear.com/7.x/personas/png?seed=SimoneCarvalho&size=128' },
  ]

  // Create users (upsert to allow re-running)
  for (const userData of usersData) {
    await prisma.user.upsert({
      where: { id: userData.id },
      create: {
        ...userData,
        passwordHash: hash,
      },
      update: {
        nome: userData.nome,
        cargo: userData.cargo,
        departamento: userData.departamento,
        avatar: userData.avatar,
      },
    })
  }
  console.log(`✅ Created/updated ${usersData.length} users`)

  // ─── Feedback Settings ────────────────────────────────────────────────────
  await prisma.feedbackSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton', maxFeedbacksPerDay: 5, allowPublicFeedback: true, requireApproval: true, allowAnonymous: true },
    update: {},
  })
  console.log('✅ Feedback settings initialized')

  // ─── Sample Courses ───────────────────────────────────────────────────────
  const courses = [
    { title: 'Liderança Transformacional', category: 'lideranca' as const, level: 'intermediario' as const, rewardXP: 150, hasCertificate: true, description: 'Desenvolva habilidades de liderança para o século XXI' },
    { title: 'Comunicação Eficaz', category: 'comunicacao' as const, level: 'iniciante' as const, rewardXP: 100, hasCertificate: false, description: 'Aprenda a comunicar com clareza e impacto' },
    { title: 'Fundamentos de Product Management', category: 'produto' as const, level: 'iniciante' as const, rewardXP: 120, hasCertificate: true, description: 'Introdução ao gerenciamento de produtos digitais' },
    { title: 'Técnicas Avançadas de Vendas', category: 'vendas' as const, level: 'avancado' as const, rewardXP: 200, hasCertificate: true, description: 'Estratégias consultivas para fechar negócios complexos' },
    { title: 'Agile & Scrum na Prática', category: 'tecnologia' as const, level: 'intermediario' as const, rewardXP: 130, hasCertificate: true, description: 'Implemente metodologias ágeis no seu time' },
  ]

  for (const courseData of courses) {
    const existing = await prisma.course.findFirst({ where: { title: courseData.title } })
    if (!existing) {
      await prisma.course.create({
        data: {
          ...courseData,
          creatorId: '1',
          lessons: {
            create: [
              { title: 'Introdução', type: 'video', duration: 15, order: 0, rewardXP: 10 },
              { title: 'Conceitos Fundamentais', type: 'reading', duration: 20, order: 1, rewardXP: 15 },
              { title: 'Prática e Exercícios', type: 'practical', duration: 30, order: 2, rewardXP: 20 },
              { title: 'Avaliação Final', type: 'quiz', duration: 10, order: 3, rewardXP: 25 },
            ],
          },
        },
      })
    }
  }
  console.log('✅ Sample courses created')

  // ─── Sample Rewards ───────────────────────────────────────────────────────
  const rewards = [
    { nome: 'Dia de Home Office Extra', descricao: 'Um dia extra de trabalho remoto', custo: 50, category: 'beneficio' },
    { nome: 'Vale Presente R$ 100', descricao: 'Vale presente em lojas parceiras', custo: 100, category: 'presente' },
    { nome: 'Curso Online Premium', descricao: 'Acesso a plataforma de cursos premium por 3 meses', custo: 80, category: 'desenvolvimento' },
    { nome: 'Almoço com o CEO', descricao: 'Almoço exclusivo com a liderança', custo: 200, category: 'experiencia' },
    { nome: 'Kit Home Office', descricao: 'Mousepad, caneca e acessórios para home office', custo: 60, category: 'produto' },
  ]

  for (const rewardData of rewards) {
    const existing = await prisma.reward.findFirst({ where: { nome: rewardData.nome } })
    if (!existing) {
      await prisma.reward.create({ data: rewardData })
    }
  }
  console.log('✅ Sample rewards created')

  // ─── Sample Daily Missions ────────────────────────────────────────────────
  const missions = [
    { nome: 'Registre seu humor', descricao: 'Registre como você está se sentindo hoje', actionType: 'registrar_humor', rewardXP: 20, diasAtivos: [1, 2, 3, 4, 5] },
    { nome: 'Publique no Feed', descricao: 'Compartilhe algo com seu time', actionType: 'criar_post', rewardXP: 30, diasAtivos: [1, 2, 3, 4, 5] },
    { nome: 'Dê um feedback', descricao: 'Reconheça um colega hoje', actionType: 'dar_feedback', rewardXP: 50, diasAtivos: [1, 3, 5] },
    { nome: 'Acesse a plataforma', descricao: 'Faça login e explore o portal', actionType: 'acessar_plataforma', rewardXP: 10, diasAtivos: [0, 1, 2, 3, 4, 5, 6] },
  ]

  for (const missionData of missions) {
    const existing = await prisma.dailyMission.findFirst({ where: { nome: missionData.nome } })
    if (!existing) {
      await prisma.dailyMission.create({ data: { ...missionData, actionType: missionData.actionType as any } })
    }
  }
  console.log('✅ Sample daily missions created')

  // ─── Sample Events ────────────────────────────────────────────────────────
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + 14)

  const eventExists = await prisma.evento.findFirst({ where: { title: 'Hackathon EngageAI 2025' } })
  if (!eventExists) {
    await prisma.evento.create({
      data: {
        title: 'Hackathon EngageAI 2025',
        description: 'Desafio de inovação interna - construa soluções para o futuro',
        date: futureDate,
        location: 'Sede da Empresa - Auditório Principal',
        rewardXP: 200,
        maxParticipants: 50,
        evidenceType: 'foto',
        creatorId: '1',
      },
    })
  }
  console.log('✅ Sample event created')

  console.log('\n🎉 Seed completed!')
  console.log(`\n📋 Default credentials:`)
  console.log(`   Super Admin: carlos.eduardo@engageai.com / ${DEFAULT_PASSWORD}`)
  console.log(`   Gestor:      marina.oliveira@engageai.com / ${DEFAULT_PASSWORD}`)
  console.log(`   Colaborador: ana.carolina@engageai.com / ${DEFAULT_PASSWORD}`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
