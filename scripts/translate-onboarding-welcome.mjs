#!/usr/bin/env node
/**
 * One-shot script to seed the onboarding "Welcome" step copy in every
 * locale we ship. Idempotent — re-running rewrites the same keys with
 * the same values, no harm done.
 *
 * Why a script: 30 locales × ~12 keys = 360 string edits. Single source
 * of truth (this file) is much easier to keep in sync than an Edit-tool
 * march through 30 JSON files.
 *
 * What it touches in each `messages/<locale>.json`:
 *   onboarding.welcome.{titleReturning, titleNew, eyebrowNew,
 *                        eyebrowReturning, descriptionReturning,
 *                        descriptionNew, footerNote}
 *   onboarding.{nameLabel, namePlaceholder, companyLabel,
 *                companyPlaceholder, websiteLabel, websitePlaceholder,
 *                optional}
 *
 * Usage:  node scripts/translate-onboarding-welcome.mjs
 *
 * Translation quality: drafted by a native-fluent multilingual model.
 * For production-critical strings, hand off to a human reviewer per
 * locale. The keys and structure are correct; only the wording is
 * approximate.
 *
 * Brand voice: each locale honors its existing register (formal/informal,
 * polite/casual). The brand name "Coasty" is left untransliterated
 * (latin script) in every locale to keep the wordmark consistent across
 * marketing surfaces. Action verbs (browse / click / type / ship) are
 * adapted to whatever reads natural in each language; literal
 * translation of all four verbs is dropped where it sounds stilted
 * (e.g. Korean, Japanese — kept the verbs but loosened punctuation).
 */
import { promises as fs } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const messagesDir = path.join(__dirname, "..", "messages")

// ─── Translations ──────────────────────────────────────────────────────
//
// Keep this object alphabetized by locale code so re-grepping for a
// language is fast. Every locale must define the same key set; missing
// any will fall back to the English text the i18n provider serves.

const TRANSLATIONS = {
  ar: {
    welcome: {
      titleReturning: "مرحباً بعودتك{name}",
      titleNew: "مرحباً بك في Coasty",
      eyebrowNew: "لنتعرّف عليك",
      eyebrowReturning: "اقتربنا",
      descriptionReturning: "بضع تفاصيل أخرى وسيكون Coasty مضبوطاً تماماً لأسلوب عملك.",
      descriptionNew: "Coasty يعمل على أجهزة كمبيوتر حقيقية — يتصفح، ينقر، يكتب، ينجز. بضعة تفاصيل سريعة ليناسب طريقة عملك.",
      footerNote: "يستغرق دقيقة تقريباً. يمكنك تغيير أي شيء لاحقاً في الإعدادات.",
    },
    nameLabel: "ماذا نسميك؟",
    namePlaceholder: "اسمك الأول فقط",
    companyLabel: "أين تعمل؟",
    companyPlaceholder: "شركتك أو فريقك",
    websiteLabel: "الموقع الإلكتروني",
    websitePlaceholder: "yourcompany.com",
    optional: "(اختياري)",
  },

  cs: {
    welcome: {
      titleReturning: "Vítejte zpět{name}",
      titleNew: "Vítejte v Coasty",
      eyebrowNew: "Pojďme se poznat",
      eyebrowReturning: "Skoro hotovo",
      descriptionReturning: "Ještě pár detailů a Coasty bude plně přizpůsoben vašemu způsobu práce.",
      descriptionNew: "Coasty pracuje na skutečných počítačích — prohlíží, klikne, píše, doručuje. Pár rychlých detailů, aby seděl vašemu stylu.",
      footerNote: "Trvá to asi minutu. Cokoli můžete později změnit v Nastavení.",
    },
    nameLabel: "Jak vás máme oslovovat?",
    namePlaceholder: "Stačí křestní jméno",
    companyLabel: "Kde pracujete?",
    companyPlaceholder: "Vaše firma nebo tým",
    websiteLabel: "Web",
    websitePlaceholder: "vasefirma.com",
    optional: "(volitelné)",
  },

  da: {
    welcome: {
      titleReturning: "Velkommen tilbage{name}",
      titleNew: "Velkommen til Coasty",
      eyebrowNew: "Lad os lære dig at kende",
      eyebrowReturning: "Næsten færdig",
      descriptionReturning: "Bare et par detaljer mere, og Coasty vil være fuldt tilpasset din arbejdsmåde.",
      descriptionNew: "Coasty arbejder på rigtige computere — browser, klikker, skriver, leverer. Et par hurtige detaljer, så det passer til din stil.",
      footerNote: "Tager cirka et minut. Du kan ændre alt senere i Indstillinger.",
    },
    nameLabel: "Hvad skal vi kalde dig?",
    namePlaceholder: "Bare dit fornavn",
    companyLabel: "Hvor arbejder du?",
    companyPlaceholder: "Din virksomhed eller dit team",
    websiteLabel: "Hjemmeside",
    websitePlaceholder: "ditfirma.com",
    optional: "(valgfrit)",
  },

  de: {
    welcome: {
      titleReturning: "Willkommen zurück{name}",
      titleNew: "Willkommen bei Coasty",
      eyebrowNew: "Lass uns dich kennenlernen",
      eyebrowReturning: "Fast geschafft",
      descriptionReturning: "Noch ein paar Details und Coasty ist perfekt auf deine Arbeitsweise abgestimmt.",
      descriptionNew: "Coasty arbeitet auf echten Computern — surft, klickt, tippt, liefert. Ein paar schnelle Details, damit es zu deinem Stil passt.",
      footerNote: "Dauert etwa eine Minute. Du kannst alles später in den Einstellungen ändern.",
    },
    nameLabel: "Wie sollen wir dich nennen?",
    namePlaceholder: "Nur dein Vorname",
    companyLabel: "Wo arbeitest du?",
    companyPlaceholder: "Dein Unternehmen oder Team",
    websiteLabel: "Website",
    websitePlaceholder: "deinefirma.de",
    optional: "(optional)",
  },

  el: {
    welcome: {
      titleReturning: "Καλώς ήρθες πίσω{name}",
      titleNew: "Καλώς ήρθες στο Coasty",
      eyebrowNew: "Ας γνωριστούμε",
      eyebrowReturning: "Σχεδόν έτοιμοι",
      descriptionReturning: "Μερικές ακόμη λεπτομέρειες και το Coasty θα είναι πλήρως προσαρμοσμένο στον τρόπο που εργάζεσαι.",
      descriptionNew: "Το Coasty δουλεύει σε πραγματικούς υπολογιστές — περιηγείται, κάνει κλικ, πληκτρολογεί, παραδίδει. Μερικές γρήγορες λεπτομέρειες για να ταιριάζει στο στυλ σου.",
      footerNote: "Παίρνει περίπου ένα λεπτό. Μπορείς να αλλάξεις τα πάντα αργότερα στις Ρυθμίσεις.",
    },
    nameLabel: "Πώς να σε αποκαλούμε;",
    namePlaceholder: "Μόνο το όνομά σου",
    companyLabel: "Πού εργάζεσαι;",
    companyPlaceholder: "Η εταιρεία ή η ομάδα σου",
    websiteLabel: "Ιστότοπος",
    websitePlaceholder: "etaireia-sou.com",
    optional: "(προαιρετικό)",
  },

  en: {
    welcome: {
      titleReturning: "Welcome back{name}",
      titleNew: "Welcome to Coasty",
      eyebrowNew: "Let's get acquainted",
      eyebrowReturning: "Almost there",
      descriptionReturning: "Just a few more details and Coasty will be fully tuned to the way you work.",
      descriptionNew: "Coasty works on real computers — browses, clicks, types, ships. A few quick details so it fits the way you work.",
      footerNote: "Takes about a minute. You can change anything later in Settings.",
    },
    nameLabel: "What should we call you?",
    namePlaceholder: "Just your first name",
    companyLabel: "Where do you work?",
    companyPlaceholder: "Your company or team",
    websiteLabel: "Website",
    websitePlaceholder: "yourcompany.com",
    optional: "(optional)",
  },

  es: {
    welcome: {
      titleReturning: "Bienvenido de nuevo{name}",
      titleNew: "Bienvenido a Coasty",
      eyebrowNew: "Conozcámonos",
      eyebrowReturning: "Casi listo",
      descriptionReturning: "Solo unos detalles más y Coasty estará perfectamente ajustado a tu forma de trabajar.",
      descriptionNew: "Coasty trabaja en computadoras reales — navega, hace clic, escribe, entrega. Unos detalles rápidos para que encaje con tu estilo.",
      footerNote: "Toma alrededor de un minuto. Puedes cambiar todo después en Ajustes.",
    },
    nameLabel: "¿Cómo debemos llamarte?",
    namePlaceholder: "Solo tu nombre de pila",
    companyLabel: "¿Dónde trabajas?",
    companyPlaceholder: "Tu empresa o equipo",
    websiteLabel: "Sitio web",
    websitePlaceholder: "tuempresa.com",
    optional: "(opcional)",
  },

  fi: {
    welcome: {
      titleReturning: "Tervetuloa takaisin{name}",
      titleNew: "Tervetuloa Coastyyn",
      eyebrowNew: "Tutustutaan",
      eyebrowReturning: "Melkein valmis",
      descriptionReturning: "Vielä muutama yksityiskohta ja Coasty on täysin viritetty työskentelytavallesi.",
      descriptionNew: "Coasty toimii oikeilla tietokoneilla — selaa, klikkaa, kirjoittaa, toimittaa. Muutama nopea yksityiskohta, jotta se sopii tyyliisi.",
      footerNote: "Vie noin minuutin. Voit muuttaa mitä tahansa myöhemmin Asetuksissa.",
    },
    nameLabel: "Miten meidän pitäisi kutsua sinua?",
    namePlaceholder: "Pelkkä etunimi riittää",
    companyLabel: "Missä työskentelet?",
    companyPlaceholder: "Yrityksesi tai tiimisi",
    websiteLabel: "Verkkosivusto",
    websitePlaceholder: "yrityksesi.com",
    optional: "(valinnainen)",
  },

  fil: {
    welcome: {
      titleReturning: "Maligayang pagbabalik{name}",
      titleNew: "Maligayang pagdating sa Coasty",
      eyebrowNew: "Magpakilala muna",
      eyebrowReturning: "Malapit na",
      descriptionReturning: "Ilang detalye na lang at lubos nang akma ang Coasty sa paraan mo ng pagtatrabaho.",
      descriptionNew: "Gumagana ang Coasty sa totoong mga computer — nag-bo-browse, nag-cli-click, nagta-type, naghahatid. Ilang mabilis na detalye para iangkop ito sa style mo.",
      footerNote: "Mga isang minuto lang. Pwede mong baguhin lahat sa Settings mamaya.",
    },
    nameLabel: "Anong itatawag namin sa iyo?",
    namePlaceholder: "First name lang",
    companyLabel: "Saan ka nagtatrabaho?",
    companyPlaceholder: "Ang kumpanya o team mo",
    websiteLabel: "Website",
    websitePlaceholder: "kumpanyamo.com",
    optional: "(opsyonal)",
  },

  fr: {
    welcome: {
      titleReturning: "Bon retour{name}",
      titleNew: "Bienvenue sur Coasty",
      eyebrowNew: "Faisons connaissance",
      eyebrowReturning: "Presque fini",
      descriptionReturning: "Encore quelques détails et Coasty sera parfaitement adapté à votre façon de travailler.",
      descriptionNew: "Coasty travaille sur de vrais ordinateurs — navigue, clique, tape, livre. Quelques détails rapides pour qu'il s'adapte à votre style.",
      footerNote: "Prend environ une minute. Vous pouvez tout modifier plus tard dans les Paramètres.",
    },
    nameLabel: "Comment devons-nous vous appeler ?",
    namePlaceholder: "Juste votre prénom",
    companyLabel: "Où travaillez-vous ?",
    companyPlaceholder: "Votre entreprise ou équipe",
    websiteLabel: "Site web",
    websitePlaceholder: "votreentreprise.com",
    optional: "(facultatif)",
  },

  he: {
    welcome: {
      titleReturning: "ברוכים השבים{name}",
      titleNew: "ברוכים הבאים ל-Coasty",
      eyebrowNew: "בואו נכיר",
      eyebrowReturning: "כמעט שם",
      descriptionReturning: "עוד כמה פרטים ו-Coasty יותאם באופן מלא לאופן העבודה שלכם.",
      descriptionNew: "Coasty עובד על מחשבים אמיתיים — גולש, לוחץ, מקליד, מספק. כמה פרטים מהירים כדי שיתאים לסגנון שלכם.",
      footerNote: "לוקח בערך דקה. אפשר לשנות הכול מאוחר יותר בהגדרות.",
    },
    nameLabel: "איך נקרא לכם?",
    namePlaceholder: "רק השם הפרטי",
    companyLabel: "איפה אתם עובדים?",
    companyPlaceholder: "החברה או הצוות שלכם",
    websiteLabel: "אתר אינטרנט",
    websitePlaceholder: "yourcompany.com",
    optional: "(אופציונלי)",
  },

  hi: {
    welcome: {
      titleReturning: "वापस आने पर स्वागत है{name}",
      titleNew: "Coasty में आपका स्वागत है",
      eyebrowNew: "आइए परिचित हों",
      eyebrowReturning: "बस थोड़ा और",
      descriptionReturning: "बस कुछ और जानकारी और Coasty आपके काम करने के तरीके के अनुसार पूरी तरह से तैयार हो जाएगा।",
      descriptionNew: "Coasty असली कंप्यूटरों पर काम करता है — ब्राउज़ करता है, क्लिक करता है, टाइप करता है, डिलीवर करता है। आपकी शैली के अनुरूप बनाने के लिए कुछ त्वरित विवरण।",
      footerNote: "लगभग एक मिनट लगता है। आप बाद में सेटिंग्स में कुछ भी बदल सकते हैं।",
    },
    nameLabel: "हम आपको क्या पुकारें?",
    namePlaceholder: "बस आपका पहला नाम",
    companyLabel: "आप कहाँ काम करते हैं?",
    companyPlaceholder: "आपकी कंपनी या टीम",
    websiteLabel: "वेबसाइट",
    websitePlaceholder: "yourcompany.com",
    optional: "(वैकल्पिक)",
  },

  hu: {
    welcome: {
      titleReturning: "Üdv újra itt{name}",
      titleNew: "Üdvözlünk a Coastynál",
      eyebrowNew: "Ismerkedjünk meg",
      eyebrowReturning: "Mindjárt kész",
      descriptionReturning: "Még néhány részlet, és a Coasty teljesen a munkamódszeredre lesz hangolva.",
      descriptionNew: "A Coasty igazi számítógépeken dolgozik — böngészik, kattint, gépel, szállít. Néhány gyors részlet, hogy az ízlésedhez igazodjon.",
      footerNote: "Körülbelül egy percig tart. Bármit módosíthatsz később a Beállításokban.",
    },
    nameLabel: "Hogyan szólítsunk?",
    namePlaceholder: "Elég a keresztneved",
    companyLabel: "Hol dolgozol?",
    companyPlaceholder: "A céged vagy csapatod",
    websiteLabel: "Webhely",
    websitePlaceholder: "ceged.hu",
    optional: "(opcionális)",
  },

  id: {
    welcome: {
      titleReturning: "Selamat datang kembali{name}",
      titleNew: "Selamat datang di Coasty",
      eyebrowNew: "Mari berkenalan",
      eyebrowReturning: "Hampir selesai",
      descriptionReturning: "Hanya beberapa detail lagi dan Coasty akan sepenuhnya disesuaikan dengan cara Anda bekerja.",
      descriptionNew: "Coasty bekerja di komputer sungguhan — menjelajah, mengklik, mengetik, mengirim. Beberapa detail cepat agar sesuai dengan gaya Anda.",
      footerNote: "Hanya butuh sekitar satu menit. Anda dapat mengubah apa pun nanti di Pengaturan.",
    },
    nameLabel: "Apa yang harus kami panggil Anda?",
    namePlaceholder: "Cukup nama depan saja",
    companyLabel: "Di mana Anda bekerja?",
    companyPlaceholder: "Perusahaan atau tim Anda",
    websiteLabel: "Situs web",
    websitePlaceholder: "perusahaananda.com",
    optional: "(opsional)",
  },

  it: {
    welcome: {
      titleReturning: "Bentornato{name}",
      titleNew: "Benvenuto su Coasty",
      eyebrowNew: "Conosciamoci",
      eyebrowReturning: "Quasi finito",
      descriptionReturning: "Solo qualche altro dettaglio e Coasty sarà perfettamente adattato al tuo modo di lavorare.",
      descriptionNew: "Coasty lavora su computer reali — naviga, clicca, scrive, consegna. Qualche dettaglio rapido per adattarlo al tuo stile.",
      footerNote: "Richiede circa un minuto. Puoi modificare tutto più tardi nelle Impostazioni.",
    },
    nameLabel: "Come dovremmo chiamarti?",
    namePlaceholder: "Solo il tuo nome",
    companyLabel: "Dove lavori?",
    companyPlaceholder: "La tua azienda o team",
    websiteLabel: "Sito web",
    websitePlaceholder: "tuaazienda.it",
    optional: "(opzionale)",
  },

  ja: {
    welcome: {
      titleReturning: "おかえりなさい{name}",
      titleNew: "Coasty へようこそ",
      eyebrowNew: "はじめまして",
      eyebrowReturning: "あと少し",
      descriptionReturning: "あと少しの情報で、Coasty があなたの働き方に最適化されます。",
      descriptionNew: "Coasty は本物のコンピュータで動きます — ブラウズ、クリック、入力、納品。あなたのスタイルに合わせるためのいくつかの簡単な質問です。",
      footerNote: "約1分かかります。後から設定でいつでも変更できます。",
    },
    nameLabel: "なんとお呼びしましょうか？",
    namePlaceholder: "ファーストネームで結構です",
    companyLabel: "どちらでお勤めですか？",
    companyPlaceholder: "会社名またはチーム名",
    websiteLabel: "ウェブサイト",
    websitePlaceholder: "yourcompany.com",
    optional: "(任意)",
  },

  ko: {
    welcome: {
      titleReturning: "다시 오신 것을 환영합니다{name}",
      titleNew: "Coasty에 오신 것을 환영합니다",
      eyebrowNew: "자기소개부터",
      eyebrowReturning: "거의 다 왔어요",
      descriptionReturning: "몇 가지 정보만 더 입력하면 Coasty가 회원님의 업무 방식에 완벽하게 맞춰집니다.",
      descriptionNew: "Coasty는 실제 컴퓨터에서 동작합니다 — 탐색, 클릭, 입력, 전달까지. 회원님의 스타일에 맞춰드릴 몇 가지 간단한 질문이 있습니다.",
      footerNote: "약 1분 소요됩니다. 나중에 설정에서 언제든지 변경할 수 있습니다.",
    },
    nameLabel: "어떻게 불러드릴까요?",
    namePlaceholder: "이름만 적어주세요",
    companyLabel: "어디에서 일하시나요?",
    companyPlaceholder: "회사 또는 팀",
    websiteLabel: "웹사이트",
    websitePlaceholder: "yourcompany.com",
    optional: "(선택)",
  },

  ms: {
    welcome: {
      titleReturning: "Selamat kembali{name}",
      titleNew: "Selamat datang ke Coasty",
      eyebrowNew: "Mari berkenalan",
      eyebrowReturning: "Hampir siap",
      descriptionReturning: "Beberapa butiran lagi dan Coasty akan benar-benar disesuaikan dengan cara anda bekerja.",
      descriptionNew: "Coasty berjalan pada komputer sebenar — melayari, mengklik, menaip, menghantar. Beberapa butiran ringkas untuk menyesuaikannya dengan gaya anda.",
      footerNote: "Mengambil masa kira-kira seminit. Anda boleh mengubah apa-apa kemudian dalam Tetapan.",
    },
    nameLabel: "Apa kami patut panggil anda?",
    namePlaceholder: "Nama pertama sahaja",
    companyLabel: "Di mana anda bekerja?",
    companyPlaceholder: "Syarikat atau pasukan anda",
    websiteLabel: "Laman web",
    websitePlaceholder: "syarikatanda.com",
    optional: "(pilihan)",
  },

  nl: {
    welcome: {
      titleReturning: "Welkom terug{name}",
      titleNew: "Welkom bij Coasty",
      eyebrowNew: "Laten we kennismaken",
      eyebrowReturning: "Bijna klaar",
      descriptionReturning: "Nog een paar details en Coasty is volledig afgestemd op jouw manier van werken.",
      descriptionNew: "Coasty werkt op echte computers — bladert, klikt, typt, levert. Een paar snelle details zodat het bij jouw stijl past.",
      footerNote: "Duurt ongeveer een minuut. Je kunt alles later wijzigen in Instellingen.",
    },
    nameLabel: "Hoe moeten we je noemen?",
    namePlaceholder: "Gewoon je voornaam",
    companyLabel: "Waar werk je?",
    companyPlaceholder: "Je bedrijf of team",
    websiteLabel: "Website",
    websitePlaceholder: "jouwbedrijf.nl",
    optional: "(optioneel)",
  },

  no: {
    welcome: {
      titleReturning: "Velkommen tilbake{name}",
      titleNew: "Velkommen til Coasty",
      eyebrowNew: "La oss bli kjent",
      eyebrowReturning: "Nesten ferdig",
      descriptionReturning: "Bare noen flere detaljer og Coasty vil være helt tilpasset måten du jobber på.",
      descriptionNew: "Coasty jobber på ekte datamaskiner — surfer, klikker, skriver, leverer. Noen raske detaljer slik at det passer til din stil.",
      footerNote: "Tar omtrent et minutt. Du kan endre alt senere i Innstillinger.",
    },
    nameLabel: "Hva skal vi kalle deg?",
    namePlaceholder: "Bare fornavnet ditt",
    companyLabel: "Hvor jobber du?",
    companyPlaceholder: "Din bedrift eller team",
    websiteLabel: "Nettsted",
    websitePlaceholder: "dittfirma.no",
    optional: "(valgfritt)",
  },

  pl: {
    welcome: {
      titleReturning: "Witaj ponownie{name}",
      titleNew: "Witaj w Coasty",
      eyebrowNew: "Poznajmy się",
      eyebrowReturning: "Już prawie",
      descriptionReturning: "Jeszcze kilka szczegółów i Coasty będzie w pełni dostosowany do sposobu, w jaki pracujesz.",
      descriptionNew: "Coasty działa na prawdziwych komputerach — przegląda, klika, pisze, dostarcza. Kilka szybkich szczegółów, aby dopasować się do Twojego stylu.",
      footerNote: "Zajmuje około minuty. Wszystko możesz zmienić później w Ustawieniach.",
    },
    nameLabel: "Jak mamy się do Ciebie zwracać?",
    namePlaceholder: "Wystarczy imię",
    companyLabel: "Gdzie pracujesz?",
    companyPlaceholder: "Twoja firma lub zespół",
    websiteLabel: "Strona internetowa",
    websitePlaceholder: "twojafirma.pl",
    optional: "(opcjonalne)",
  },

  pt: {
    welcome: {
      titleReturning: "Bem-vindo de volta{name}",
      titleNew: "Bem-vindo ao Coasty",
      eyebrowNew: "Vamos nos conhecer",
      eyebrowReturning: "Quase lá",
      descriptionReturning: "Só mais alguns detalhes e o Coasty estará totalmente ajustado ao seu jeito de trabalhar.",
      descriptionNew: "O Coasty trabalha em computadores reais — navega, clica, digita, entrega. Alguns detalhes rápidos para se adaptar ao seu estilo.",
      footerNote: "Leva cerca de um minuto. Você pode alterar tudo depois nas Configurações.",
    },
    nameLabel: "Como devemos te chamar?",
    namePlaceholder: "Apenas seu primeiro nome",
    companyLabel: "Onde você trabalha?",
    companyPlaceholder: "Sua empresa ou time",
    websiteLabel: "Site",
    websitePlaceholder: "suaempresa.com.br",
    optional: "(opcional)",
  },

  ro: {
    welcome: {
      titleReturning: "Bine ai revenit{name}",
      titleNew: "Bine ai venit la Coasty",
      eyebrowNew: "Să ne cunoaștem",
      eyebrowReturning: "Aproape gata",
      descriptionReturning: "Încă câteva detalii și Coasty va fi complet adaptat la modul tău de a lucra.",
      descriptionNew: "Coasty funcționează pe calculatoare reale — navighează, dă clic, tastează, livrează. Câteva detalii rapide pentru a se adapta stilului tău.",
      footerNote: "Durează aproximativ un minut. Poți schimba orice mai târziu în Setări.",
    },
    nameLabel: "Cum să-ți spunem?",
    namePlaceholder: "Doar prenumele",
    companyLabel: "Unde lucrezi?",
    companyPlaceholder: "Compania sau echipa ta",
    websiteLabel: "Site web",
    websitePlaceholder: "compania-ta.ro",
    optional: "(opțional)",
  },

  ru: {
    welcome: {
      titleReturning: "С возвращением{name}",
      titleNew: "Добро пожаловать в Coasty",
      eyebrowNew: "Давайте познакомимся",
      eyebrowReturning: "Почти готово",
      descriptionReturning: "Ещё несколько деталей, и Coasty будет полностью настроен под ваш стиль работы.",
      descriptionNew: "Coasty работает на настоящих компьютерах — просматривает, кликает, печатает, доставляет. Несколько быстрых деталей, чтобы настроить под ваш стиль.",
      footerNote: "Займёт около минуты. Всё можно изменить позже в Настройках.",
    },
    nameLabel: "Как нам вас называть?",
    namePlaceholder: "Просто имя",
    companyLabel: "Где вы работаете?",
    companyPlaceholder: "Ваша компания или команда",
    websiteLabel: "Веб-сайт",
    websitePlaceholder: "вашакомпания.ru",
    optional: "(необязательно)",
  },

  sv: {
    welcome: {
      titleReturning: "Välkommen tillbaka{name}",
      titleNew: "Välkommen till Coasty",
      eyebrowNew: "Låt oss lära känna varandra",
      eyebrowReturning: "Nästan klart",
      descriptionReturning: "Bara några fler detaljer och Coasty är helt anpassad till hur du arbetar.",
      descriptionNew: "Coasty arbetar på riktiga datorer — surfar, klickar, skriver, levererar. Några snabba detaljer så att det passar din stil.",
      footerNote: "Tar ungefär en minut. Du kan ändra allt senare i Inställningar.",
    },
    nameLabel: "Vad ska vi kalla dig?",
    namePlaceholder: "Bara ditt förnamn",
    companyLabel: "Var jobbar du?",
    companyPlaceholder: "Ditt företag eller team",
    websiteLabel: "Webbplats",
    websitePlaceholder: "dittforetag.se",
    optional: "(valfritt)",
  },

  th: {
    welcome: {
      titleReturning: "ยินดีต้อนรับกลับ{name}",
      titleNew: "ยินดีต้อนรับสู่ Coasty",
      eyebrowNew: "มาทำความรู้จักกัน",
      eyebrowReturning: "ใกล้เสร็จแล้ว",
      descriptionReturning: "อีกเพียงไม่กี่รายละเอียด แล้ว Coasty จะถูกปรับให้เข้ากับวิธีการทำงานของคุณอย่างสมบูรณ์",
      descriptionNew: "Coasty ทำงานบนคอมพิวเตอร์จริง — ท่อง คลิก พิมพ์ ส่งมอบ รายละเอียดสั้น ๆ ไม่กี่ข้อเพื่อปรับให้เข้ากับสไตล์ของคุณ",
      footerNote: "ใช้เวลาประมาณหนึ่งนาที คุณสามารถเปลี่ยนแปลงได้ทุกอย่างในการตั้งค่าภายหลัง",
    },
    nameLabel: "เราควรเรียกคุณว่าอะไร?",
    namePlaceholder: "แค่ชื่อจริงก็พอ",
    companyLabel: "คุณทำงานที่ไหน?",
    companyPlaceholder: "บริษัทหรือทีมของคุณ",
    websiteLabel: "เว็บไซต์",
    websitePlaceholder: "yourcompany.com",
    optional: "(ไม่บังคับ)",
  },

  tr: {
    welcome: {
      titleReturning: "Tekrar hoş geldin{name}",
      titleNew: "Coasty'ye hoş geldin",
      eyebrowNew: "Tanışalım",
      eyebrowReturning: "Neredeyse bitti",
      descriptionReturning: "Birkaç ayrıntı daha ve Coasty çalışma şekline tamamen uyarlanmış olacak.",
      descriptionNew: "Coasty gerçek bilgisayarlarda çalışır — gezinir, tıklar, yazar, teslim eder. Tarzına uyarlamak için birkaç hızlı ayrıntı.",
      footerNote: "Yaklaşık bir dakika sürer. Her şeyi daha sonra Ayarlar'dan değiştirebilirsin.",
    },
    nameLabel: "Sana nasıl hitap edelim?",
    namePlaceholder: "Sadece adın",
    companyLabel: "Nerede çalışıyorsun?",
    companyPlaceholder: "Şirketin veya ekibin",
    websiteLabel: "Web sitesi",
    websitePlaceholder: "sirketin.com",
    optional: "(isteğe bağlı)",
  },

  uk: {
    welcome: {
      titleReturning: "З поверненням{name}",
      titleNew: "Ласкаво просимо до Coasty",
      eyebrowNew: "Давайте познайомимось",
      eyebrowReturning: "Майже готово",
      descriptionReturning: "Ще кілька деталей, і Coasty буде повністю налаштований під ваш стиль роботи.",
      descriptionNew: "Coasty працює на справжніх комп'ютерах — переглядає, натискає, друкує, доставляє. Кілька швидких деталей, щоб налаштувати під ваш стиль.",
      footerNote: "Займає близько хвилини. Усе можна змінити пізніше в Налаштуваннях.",
    },
    nameLabel: "Як до вас звертатися?",
    namePlaceholder: "Просто ім'я",
    companyLabel: "Де ви працюєте?",
    companyPlaceholder: "Ваша компанія чи команда",
    websiteLabel: "Вебсайт",
    websitePlaceholder: "вашакомпанія.ua",
    optional: "(необов'язково)",
  },

  vi: {
    welcome: {
      titleReturning: "Chào mừng bạn trở lại{name}",
      titleNew: "Chào mừng đến với Coasty",
      eyebrowNew: "Hãy làm quen nào",
      eyebrowReturning: "Gần xong rồi",
      descriptionReturning: "Chỉ vài chi tiết nữa và Coasty sẽ được tinh chỉnh hoàn toàn phù hợp với cách bạn làm việc.",
      descriptionNew: "Coasty hoạt động trên máy tính thật — duyệt, nhấp, gõ, hoàn thành. Vài chi tiết nhanh để phù hợp với phong cách của bạn.",
      footerNote: "Mất khoảng một phút. Bạn có thể thay đổi mọi thứ sau trong Cài đặt.",
    },
    nameLabel: "Chúng tôi nên gọi bạn là gì?",
    namePlaceholder: "Chỉ tên gọi của bạn",
    companyLabel: "Bạn làm việc ở đâu?",
    companyPlaceholder: "Công ty hoặc nhóm của bạn",
    websiteLabel: "Trang web",
    websitePlaceholder: "congtybanban.com",
    optional: "(tùy chọn)",
  },

  zh: {
    welcome: {
      titleReturning: "欢迎回来{name}",
      titleNew: "欢迎使用 Coasty",
      eyebrowNew: "让我们认识一下",
      eyebrowReturning: "马上就好",
      descriptionReturning: "再补充几项资料，Coasty 就能完全贴合你的工作方式。",
      descriptionNew: "Coasty 在真实的电脑上工作 — 浏览、点击、输入、交付。回答几个简短问题，让它契合你的风格。",
      footerNote: "大约需要一分钟。你可以稍后在设置中更改任何内容。",
    },
    nameLabel: "我们怎么称呼你？",
    namePlaceholder: "只需名字即可",
    companyLabel: "你在哪里工作？",
    companyPlaceholder: "你的公司或团队",
    websiteLabel: "网站",
    websitePlaceholder: "yourcompany.com",
    optional: "(可选)",
  },
}

// ─── Apply ──────────────────────────────────────────────────────────────

async function main() {
  let updated = 0
  let skipped = 0

  for (const [locale, t] of Object.entries(TRANSLATIONS)) {
    const filePath = path.join(messagesDir, `${locale}.json`)
    let raw
    try {
      raw = await fs.readFile(filePath, "utf8")
    } catch (err) {
      console.warn(`✗ ${locale}: file not found, skipping`)
      skipped++
      continue
    }

    // Detect line ending convention so we can preserve it on write.
    // Windows checkouts often have CRLF; running JSON.stringify alone
    // would silently rewrite the whole file with LF.
    const usesCRLF = raw.includes("\r\n")
    // Detect final newline so we don't toggle it on/off across runs.
    const hasFinalNewline = raw.endsWith("\n") || raw.endsWith("\r\n")

    let json
    try {
      json = JSON.parse(raw)
    } catch (err) {
      console.warn(`✗ ${locale}: invalid JSON — ${err.message}`)
      skipped++
      continue
    }

    if (!json.onboarding || typeof json.onboarding !== "object") {
      console.warn(`✗ ${locale}: no \"onboarding\" object`)
      skipped++
      continue
    }

    // Replace welcome wholesale so the new keys (eyebrow*, footerNote)
    // appear in the order we define them, not appended at the end.
    json.onboarding.welcome = { ...t.welcome }

    // Update the sibling form-field strings in place. Object.assign
    // preserves the existing key order for keys that already exist;
    // any of these that are new for this locale will be appended.
    Object.assign(json.onboarding, {
      nameLabel: t.nameLabel,
      namePlaceholder: t.namePlaceholder,
      companyLabel: t.companyLabel,
      companyPlaceholder: t.companyPlaceholder,
      websiteLabel: t.websiteLabel,
      websitePlaceholder: t.websitePlaceholder,
      optional: t.optional,
    })

    let output = JSON.stringify(json, null, 2)
    if (hasFinalNewline) output += "\n"
    if (usesCRLF) output = output.replace(/\n/g, "\r\n")

    await fs.writeFile(filePath, output, "utf8")
    console.log(`✓ ${locale}`)
    updated++
  }

  console.log(`\n${updated} updated, ${skipped} skipped, ${Object.keys(TRANSLATIONS).length} total locales in script.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
