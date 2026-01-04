import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      welcomeTitle: "Explore the history that shaped today's YMCA.",
      welcomeSubtitle: "Ask questions, discover stories, and draw lessons from the past to inspire leadership today.",
      starterCrisisTitle: "The YMCA in Times of Crisis",
      starterCrisisDesc: "How the Y responded when communities needed it most",
      starterYouthTitle: "Youth Programs Through the Decades",
      starterYouthDesc: "How the Y shaped young lives across generations",
      starterLeadershipTitle: "Leadership & Social Responsibility",
      starterLeadershipDesc: "Stories of courage, change, and moral leadership",
      starterInnovationTitle: "Innovation and Change at the Y",
      starterInnovationDesc: "From basketball to new models of community service",
      inputPlaceholder: "Ask your own question about YMCA history, programs, or leadership…"
    }
  },
  es: {
    translation: {
      welcomeTitle: "Explore la historia que formó el YMCA de hoy.",
      welcomeSubtitle: "Haga preguntas, descubra historias y extraiga lecciones del pasado para inspirar el liderazgo hoy.",
      starterCrisisTitle: "El YMCA en Tiempos de Crisis",
      starterCrisisDesc: "Cómo respondió el Y cuando las comunidades más lo necesitaban",
      starterYouthTitle: "Programas Juveniles a Través de las Décadas",
      starterYouthDesc: "Cómo el Y moldeó vidas jóvenes a través de generaciones",
      starterLeadershipTitle: "Liderazgo y Responsabilidad Social",
      starterLeadershipDesc: "Historias de coraje, cambio y liderazgo moral",
      starterInnovationTitle: "Innovación y Cambio en el Y",
      starterInnovationDesc: "Desde el baloncesto hasta nuevos modelos de servicio comunitario",
      inputPlaceholder: "Haga su propia pregunta sobre la historia, programas o liderazgo del YMCA…"
    }
  },
  fr: {
    translation: {
      welcomeTitle: "Explorez l'histoire qui a façonné le YMCA d'aujourd'hui.",
      welcomeSubtitle: "Posez des questions, découvrez des histoires et tirez des leçons du passé pour inspirer le leadership aujourd'hui.",
      starterCrisisTitle: "Le YMCA en Temps de Crise",
      starterCrisisDesc: "Comment le Y a répondu quand les communautés en avaient le plus besoin",
      starterYouthTitle: "Programmes pour les Jeunes à Travers les Décennies",
      starterYouthDesc: "Comment le Y a façonné de jeunes vies à travers les générations",
      starterLeadershipTitle: "Leadership et Responsabilité Sociale",
      starterLeadershipDesc: "Histoires de courage, de changement et de leadership moral",
      starterInnovationTitle: "Innovation et Changement au Y",
      starterInnovationDesc: "Du basketball aux nouveaux modèles de service communautaire",
      inputPlaceholder: "Posez votre propre question sur l'histoire, les programmes ou le leadership du YMCA…"
    }
  },
  de: {
    translation: {
      welcomeTitle: "Entdecken Sie die Geschichte, die das heutige YMCA geprägt hat.",
      welcomeSubtitle: "Stellen Sie Fragen, entdecken Sie Geschichten und ziehen Sie Lehren aus der Vergangenheit, um heute Führung zu inspirieren.",
      starterCrisisTitle: "Das YMCA in Krisenzeiten",
      starterCrisisDesc: "Wie das Y reagierte, als die Gemeinschaften es am meisten brauchten",
      starterYouthTitle: "Jugendprogramme durch die Jahrzehnte",
      starterYouthDesc: "Wie das Y junge Leben über Generationen hinweg geprägt hat",
      starterLeadershipTitle: "Führung und Soziale Verantwortung",
      starterLeadershipDesc: "Geschichten von Mut, Veränderung und moralischer Führung",
      starterInnovationTitle: "Innovation und Wandel beim Y",
      starterInnovationDesc: "Von Basketball bis zu neuen Modellen des Gemeinschaftsdienstes",
      inputPlaceholder: "Stellen Sie Ihre eigene Frage zur Geschichte, zu Programmen oder zur Führung des YMCA…"
    }
  },
  it: {
    translation: {
      welcomeTitle: "Esplora la storia che ha plasmato il YMCA di oggi.",
      welcomeSubtitle: "Fai domande, scopri storie e trai lezioni dal passato per ispirare la leadership oggi.",
      starterCrisisTitle: "Il YMCA nei Momenti di Crisi",
      starterCrisisDesc: "Come il Y ha risposto quando le comunità ne avevano più bisogno",
      starterYouthTitle: "Programmi Giovanili attraverso i Decenni",
      starterYouthDesc: "Come il Y ha plasmato giovani vite attraverso le generazioni",
      starterLeadershipTitle: "Leadership e Responsabilità Sociale",
      starterLeadershipDesc: "Storie di coraggio, cambiamento e leadership morale",
      starterInnovationTitle: "Innovazione e Cambiamento al Y",
      starterInnovationDesc: "Dal basket ai nuovi modelli di servizio comunitario",
      inputPlaceholder: "Fai la tua domanda sulla storia, i programmi o la leadership del YMCA…"
    }
  },
  pt: {
    translation: {
      welcomeTitle: "Explore a história que moldou o YMCA de hoje.",
      welcomeSubtitle: "Faça perguntas, descubra histórias e tire lições do passado para inspirar a liderança hoje.",
      starterCrisisTitle: "O YMCA em Tempos de Crise",
      starterCrisisDesc: "Como o Y respondeu quando as comunidades mais precisavam",
      starterYouthTitle: "Programas Juvenis ao Longo das Décadas",
      starterYouthDesc: "Como o Y moldou jovens vidas através das gerações",
      starterLeadershipTitle: "Liderança e Responsabilidade Social",
      starterLeadershipDesc: "Histórias de coragem, mudança e liderança moral",
      starterInnovationTitle: "Inovação e Mudança no Y",
      starterInnovationDesc: "Do basquete aos novos modelos de serviço comunitário",
      inputPlaceholder: "Faça sua própria pergunta sobre a história, programas ou liderança do YMCA…"
    }
  },
  zh: {
    translation: {
      welcomeTitle: "探索塑造今日YMCA的历史。",
      welcomeSubtitle: "提出问题，发现故事，从过去中汲取教训，激励今日的领导力。",
      starterCrisisTitle: "危机时期的YMCA",
      starterCrisisDesc: "当社区最需要时，Y如何回应",
      starterYouthTitle: "几十年来的青年项目",
      starterYouthDesc: "Y如何跨越几代人塑造年轻生命",
      starterLeadershipTitle: "领导力与社会责任",
      starterLeadershipDesc: "勇气、变革和道德领导力的故事",
      starterInnovationTitle: "Y的创新与变革",
      starterInnovationDesc: "从篮球到社区服务的新模式",
      inputPlaceholder: "提出您关于YMCA历史、项目或领导力的问题…"
    }
  },
  ja: {
    translation: {
      welcomeTitle: "今日のYMCAを形作った歴史を探索しましょう。",
      welcomeSubtitle: "質問し、物語を発見し、過去から教訓を引き出して今日のリーダーシップを刺激しましょう。",
      starterCrisisTitle: "危機の時代のYMCA",
      starterCrisisDesc: "コミュニティが最も必要としたときにYがどのように対応したか",
      starterYouthTitle: "数十年にわたる青少年プログラム",
      starterYouthDesc: "Yが世代を超えて若者の人生をどのように形作ったか",
      starterLeadershipTitle: "リーダーシップと社会的責任",
      starterLeadershipDesc: "勇気、変化、道徳的リーダーシップの物語",
      starterInnovationTitle: "Yのイノベーションと変化",
      starterInnovationDesc: "バスケットボールから新しいコミュニティサービスモデルまで",
      inputPlaceholder: "YMCAの歴史、プログラム、またはリーダーシップについて質問してください…"
    }
  },
  ko: {
    translation: {
      welcomeTitle: "오늘날 YMCA를 형성한 역사를 탐험하세요.",
      welcomeSubtitle: "질문하고, 이야기를 발견하고, 과거로부터 교훈을 얻어 오늘날의 리더십을 고취하세요.",
      starterCrisisTitle: "위기 시기의 YMCA",
      starterCrisisDesc: "커뮤니티가 가장 필요로 할 때 Y가 어떻게 대응했는지",
      starterYouthTitle: "수십 년에 걸친 청소년 프로그램",
      starterYouthDesc: "Y가 세대를 넘어 젊은 삶을 어떻게 형성했는지",
      starterLeadershipTitle: "리더십과 사회적 책임",
      starterLeadershipDesc: "용기, 변화, 도덕적 리더십의 이야기",
      starterInnovationTitle: "Y의 혁신과 변화",
      starterInnovationDesc: "농구부터 새로운 지역 사회 봉사 모델까지",
      inputPlaceholder: "YMCA 역사, 프로그램 또는 리더십에 대한 질문을 하세요…"
    }
  },
  ar: {
    translation: {
      welcomeTitle: "استكشف التاريخ الذي شكل YMCA اليوم.",
      welcomeSubtitle: "اطرح الأسئلة، اكتشف القصص، واستخلص الدروس من الماضي لإلهام القيادة اليوم.",
      starterCrisisTitle: "YMCA في أوقات الأزمات",
      starterCrisisDesc: "كيف استجاب Y عندما احتاجته المجتمعات أكثر",
      starterYouthTitle: "برامج الشباب عبر العقود",
      starterYouthDesc: "كيف شكل Y حياة الشباب عبر الأجيال",
      starterLeadershipTitle: "القيادة والمسؤولية الاجتماعية",
      starterLeadershipDesc: "قصص الشجاعة والتغيير والقيادة الأخلاقية",
      starterInnovationTitle: "الابتكار والتغيير في Y",
      starterInnovationDesc: "من كرة السلة إلى نماذج جديدة من الخدمة المجتمعية",
      inputPlaceholder: "اطرح سؤالك الخاص حول تاريخ أو برامج أو قيادة YMCA…"
    }
  },
  hi: {
    translation: {
      welcomeTitle: "आज के YMCA को आकार देने वाले इतिहास का अन्वेषण करें।",
      welcomeSubtitle: "प्रश्न पूछें, कहानियां खोजें, और आज नेतृत्व को प्रेरित करने के लिए अतीत से सबक लें।",
      starterCrisisTitle: "संकट के समय में YMCA",
      starterCrisisDesc: "जब समुदायों को सबसे अधिक जरूरत थी तब Y ने कैसे प्रतिक्रिया दी",
      starterYouthTitle: "दशकों में युवा कार्यक्रम",
      starterYouthDesc: "Y ने पीढ़ियों में युवा जीवन को कैसे आकार दिया",
      starterLeadershipTitle: "नेतृत्व और सामाजिक जिम्मेदारी",
      starterLeadershipDesc: "साहस, परिवर्तन और नैतिक नेतृत्व की कहानियां",
      starterInnovationTitle: "Y में नवाचार और परिवर्तन",
      starterInnovationDesc: "बास्केटबॉल से लेकर सामुदायिक सेवा के नए मॉडल तक",
      inputPlaceholder: "YMCA इतिहास, कार्यक्रमों या नेतृत्व के बारे में अपना प्रश्न पूछें…"
    }
  },
  ru: {
    translation: {
      welcomeTitle: "Исследуйте историю, которая сформировала сегодняшний YMCA.",
      welcomeSubtitle: "Задавайте вопросы, открывайте истории и извлекайте уроки из прошлого, чтобы вдохновить лидерство сегодня.",
      starterCrisisTitle: "YMCA во времена кризиса",
      starterCrisisDesc: "Как Y отреагировал, когда сообществам это было больше всего нужно",
      starterYouthTitle: "Молодежные программы на протяжении десятилетий",
      starterYouthDesc: "Как Y формировал молодые жизни на протяжении поколений",
      starterLeadershipTitle: "Лидерство и социальная ответственность",
      starterLeadershipDesc: "Истории мужества, перемен и морального лидерства",
      starterInnovationTitle: "Инновации и изменения в Y",
      starterInnovationDesc: "От баскетбола до новых моделей общественного обслуживания",
      inputPlaceholder: "Задайте свой вопрос об истории, программах или лидерстве YMCA…"
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
