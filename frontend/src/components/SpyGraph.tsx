"use client";

/**
 * SpyGraph — OSINT İstihbarat İlişki Ağı Grafiği
 * Cytoscape.js ile force-directed graph. Hem statik 28 olayı hem de
 * backend'den gelen UCDP / haber verilerini görselleştirir.
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
} from "react";
import { X, ZoomIn, ZoomOut, Maximize2, RotateCcw, Network } from "lucide-react";

/* ─────────────────────────────────────────────
   TİP TANIMLAMALARI
───────────────────────────────────────────── */
interface SpyEvent {
  id: string;
  label: string;
  date: string;
  summary: string;
  sources: { label: string; url: string }[];
  categories: string[];
  live?: boolean; // backend'den gelen canlı veri mi?
}

interface SpyCategory {
  id: string;
  label: string;
}

interface DetailData {
  id: string;
  label: string;
  date: string;
  summary: string;
  sources: { label: string; url: string }[];
  categories: string[];
  live?: boolean;
}

interface SpyGraphProps {
  isOpen: boolean;
  onClose: () => void;
  /** Backend UCDP olayları (opsiyonel) */
  ucdpEvents?: Array<{
    id: string;
    conflict_name: string;
    date: string;
    country: string;
    violence_label: string;
    side_a: string;
    side_b: string;
    deaths_best: number;
    type_of_violence: number;
  }>;
  /** Backend haber akışı (opsiyonel) */
  newsItems?: Array<{
    title: string;
    published?: string;
    source?: string;
    url?: string;
    risk_score?: number;
  }>;
}

/* ─────────────────────────────────────────────
   KATEGORİ TANIMLARI
───────────────────────────────────────────── */
const CATEGORIES: SpyCategory[] = [
  { id: "cat-mossad",     label: "#Mossad"           },
  { id: "cat-cia",        label: "#CIA"               },
  { id: "cat-iran-intel", label: "#İranİstihbaratı"   },
  { id: "cat-mi6",        label: "#MI6"               },
  { id: "cat-fsb",        label: "#FSB/GRU"           },
  { id: "cat-turkiye",    label: "#Türkiye"           },
  { id: "cat-israel",     label: "#İsrail"            },
  { id: "cat-iran",       label: "#İran"              },
  { id: "cat-rusya",      label: "#Rusya"             },
  { id: "cat-abd",        label: "#ABD"               },
  { id: "cat-siber",      label: "#SiberOp"           },
  { id: "cat-humint",     label: "#HUMINT"            },
  // Canlı veri kategorileri
  { id: "cat-live-ucdp",  label: "#UCDP-CANLI"        },
  { id: "cat-live-news",  label: "#HABER-CANLI"       },
];

/* ─────────────────────────────────────────────
   STATİK OSINT OLAYLARI (28 adet)
───────────────────────────────────────────── */
const STATIC_EVENTS: SpyEvent[] = [
  { id:"ev-001", label:"İstanbul Mossad Hücresi", date:"Mart 2024",
    summary:"İstanbul'da Mossad adına faaliyet gösterdiği değerlendirilen dört kişi MİT ve İstanbul Emniyet iş birliğiyle gözaltına alındı. Şüphelilerin Türkiye'deki Hamas yöneticilerini hedef aldığı ileri sürüldü.",
    sources:[{label:"Reuters – Turkey detains alleged Mossad spies",url:"https://www.reuters.com/world/middle-east/turkey-detains-people-suspected-spying-israel-mossad-media-2024-04-11/"},{label:"BBC Türkçe – MİT operasyonu",url:"https://www.bbc.com/turkce"}],
    categories:["cat-mossad","cat-turkiye","cat-israel","cat-humint"] },
  { id:"ev-002", label:"Türk Savunma Sanayii Siber Saldırısı", date:"Ocak 2024",
    summary:"İran bağlantılı CyberAv3ngers grubunun Türk savunma tedarik zincirine yönelik spear-phishing ve zero-day saldırıları gerçekleştirdiği CISA raporlarıyla teyit edildi.",
    sources:[{label:"CISA Advisory AA24-007A",url:"https://www.cisa.gov/news-events/cybersecurity-advisories/aa24-007a"},{label:"BTK Siber Tehdit Bülteni",url:"https://www.btk.gov.tr/siber-guvenlik"}],
    categories:["cat-iran-intel","cat-turkiye","cat-siber"] },
  { id:"ev-003", label:"CIA Orta Doğu Ajan Ağı Deşifre", date:"Kasım 2023",
    summary:"Lübnan ve Irak'ta CIA adına çalıştığı ileri sürülen 12 ajan, Hizbullah ve IRGC tarafından tespit edildi. Operasyonel iletişim kanallarındaki güvenlik açığı ağın büyük bölümünü kompromize etti.",
    sources:[{label:"AP News – CIA network compromised",url:"https://apnews.com"},{label:"The Intercept – CIA Middle East",url:"https://theintercept.com"}],
    categories:["cat-cia","cat-iran","cat-abd","cat-humint"] },
  { id:"ev-004", label:"Rusya NATO Dezinformasyon Kampanyası", date:"Ekim 2023",
    summary:"GRU bağlantılı Doppelganger operasyonu, Türkiye dahil sekiz NATO üyesinde seçim süreçlerini etkileyen koordineli sahte içerik üretimi gerçekleştirdi.",
    sources:[{label:"EU External Action Service – FIMI Report",url:"https://www.eeas.europa.eu"},{label:"NATO StratCom COE",url:"https://stratcomcoe.org"}],
    categories:["cat-fsb","cat-rusya","cat-turkiye","cat-siber"] },
  { id:"ev-005", label:"Tahran Nükleer Fizikçi Suikastı", date:"Temmuz 2023",
    summary:"İran nükleer programının kıdemli fizikçisi Tahran'da aracına yerleştirilen patlayıcıyla hayatını kaybetti. İran olay Mossad'a atfederek misilleme tehdidinde bulundu.",
    sources:[{label:"BBC News – Iran nuclear scientist killed",url:"https://www.bbc.com/news/world-middle-east"},{label:"The Guardian – Mossad Iran operations",url:"https://www.theguardian.com"}],
    categories:["cat-mossad","cat-israel","cat-iran","cat-humint"] },
  { id:"ev-006", label:"İran'ın Türkiye'deki Muhalefet Takibi", date:"Şubat 2024",
    summary:"VEVAK operatörlerinin İstanbul ve Ankara'da ikamet eden İranlı muhalefet figürlerini fiziksel gözetim ve dijital takip yöntemleriyle izlediği Türk kontr-istihbarat birimlerince belirlendi.",
    sources:[{label:"IranWire – MOIS operations in Turkey",url:"https://iranwire.com"},{label:"Freedom House – Transnational Repression 2024",url:"https://freedomhouse.org/report/transnational-repression"}],
    categories:["cat-iran-intel","cat-iran","cat-turkiye","cat-humint"] },
  { id:"ev-007", label:"FSB Avrupa Derin Ajan Ağı", date:"Aralık 2023",
    summary:"Almanya BfV, Polonya ABW ve Estonya KAPO koordineli operasyonlarıyla FSB adına uzun vadeli faaliyet gösteren sekiz kişiyi sınır dışı etti.",
    sources:[{label:"BfV Verfassungsschutzbericht 2023",url:"https://www.verfassungsschutz.de"},{label:"Euractiv – Russia espionage EU",url:"https://www.euractiv.com"}],
    categories:["cat-fsb","cat-rusya","cat-humint"] },
  { id:"ev-008", label:"MI6 Körfez İstihbarat Paylaşım Ağı", date:"Eylül 2023",
    summary:"MI6'nın BAE ve Suudi Arabistan'la kurduğu ortak istihbarat paylaşım mekanizması, İran bağlantılı ağların takibine yoğunlaşıyor.",
    sources:[{label:"RUSI – UK-Gulf Intelligence Cooperation",url:"https://www.rusi.org"},{label:"Middle East Eye – MI6 Gulf networks",url:"https://www.middleeasteye.net"}],
    categories:["cat-mi6","cat-iran","cat-humint"] },
  { id:"ev-009", label:"CIA-Türkiye SIGINT Ortaklığı", date:"Ağustos 2023",
    summary:"Türkiye'deki NSA/CIA SIGINT tesislerinin İran nükleer tesislerini ve IRGC haberleşmesini izlediği gizli belgelerden anlaşıldı.",
    sources:[{label:"Der Spiegel – NSA bases Turkey",url:"https://www.spiegel.de/international"},{label:"The Intercept – SIGINT Turkey Iran",url:"https://theintercept.com"}],
    categories:["cat-cia","cat-abd","cat-turkiye","cat-iran","cat-siber"] },
  { id:"ev-010", label:"Dubai Hamas Yöneticisi Operasyonu", date:"Ocak 2024",
    summary:"Hamas yetkilisi Saleh el-Aruri'nin Beyrut'ta öldürülmesinin ardından Mossad'ın BAE üzerinden koordine ettiği değerlendirilen operasyonlar gündeme taşındı.",
    sources:[{label:"Haaretz – Mossad regional operations",url:"https://www.haaretz.com"},{label:"Al Jazeera – Hamas official killed",url:"https://www.aljazeera.com"}],
    categories:["cat-mossad","cat-israel","cat-humint"] },
  { id:"ev-011", label:"İran İsrail Altyapısına Siber Saldırı", date:"Nisan 2024",
    summary:"MuddyWater grubunun İsrail su yönetim sistemleri ve enerji altyapısına koordineli siber saldırı başlattığı INCD tarafından teyit edildi.",
    sources:[{label:"INCD – Cyber Alert April 2024",url:"https://www.gov.il/en/departments/incd"},{label:"ClearSky Security – MuddyWater TTPs",url:"https://www.clearskysec.com"}],
    categories:["cat-iran-intel","cat-iran","cat-israel","cat-siber"] },
  { id:"ev-012", label:"MİT Libya Elektronik Harp Operasyonu", date:"Haziran 2023",
    summary:"MİT'in Libya'da insansız hava aracı istihbaratı ve elektronik harp desteği sağladığı; Hafter güçlerinin haberleşmasını sekteye uğratan sinyal bozma operasyonlarını koordine ettiği belgelendi.",
    sources:[{label:"ACLED – Libya Conflict Data 2023",url:"https://acleddata.com"},{label:"Middle East Monitor – Turkish intelligence Libya",url:"https://www.middleeastmonitor.com"}],
    categories:["cat-turkiye","cat-humint","cat-siber"] },
  { id:"ev-013", label:"FSB Ukrayna Uyuyan Hücresi Çöktürüldü", date:"Mayıs 2023",
    summary:"SBU, FSB'nin Kiev, Harkiv ve Zaporijya'daki uyuyan hücre ağına yönelik kapsamlı operasyon düzenledi; 47 ajan gözaltına alındı.",
    sources:[{label:"SBU – Official press release",url:"https://sbu.gov.ua"},{label:"Kyiv Post – FSB network dismantled",url:"https://www.kyivpost.com"}],
    categories:["cat-fsb","cat-rusya","cat-humint"] },
  { id:"ev-014", label:"Ankara Büyükelçilik Casusluk Davası", date:"Şubat 2023",
    summary:"Ankara'da diplomatik misyonla bağlantılı bir Türk vatandaşının Mossad adına hassas siyasi bilgileri aktardığı iddiasıyla yargılandığı mahkeme belgelerinden anlaşıldı.",
    sources:[{label:"Cumhuriyet – Dava haberleri",url:"https://www.cumhuriyet.com.tr"},{label:"Yetkin Report – Casusluk analizi",url:"https://www.yetkinreport.com"}],
    categories:["cat-mossad","cat-israel","cat-turkiye","cat-humint"] },
  { id:"ev-015", label:"İran ABD Seçim Müdahalesi", date:"Ekim 2023",
    summary:"FBI, VEVAK bağlantılı aktörlerin 2024 seçimini etkilemek amacıyla koordineli dezenformasyon ve hackleme kampanyası yürüttüğünü açıkladı.",
    sources:[{label:"FBI PIN – Iran election interference 2023",url:"https://www.ic3.gov"},{label:"ODNI – Election Threats Report 2023",url:"https://www.odni.gov"}],
    categories:["cat-iran-intel","cat-iran","cat-abd","cat-siber"] },
  { id:"ev-016", label:"Küba-Çin SIGINT İstasyonu Skandalı", date:"Temmuz 2023",
    summary:"Küba'nın Çin finansmanıyla inşa ettiği SIGINT tesisinin ABD Güney Komutanlığı iletişimlerini izlediği WSJ araştırmasıyla gün yüzüne çıktı.",
    sources:[{label:"WSJ – China spy base Cuba",url:"https://www.wsj.com"},{label:"CNN National Security – Cuba SIGINT",url:"https://www.cnn.com"}],
    categories:["cat-cia","cat-abd","cat-siber"] },
  { id:"ev-017", label:"Rusya TIR Silah Takip Operasyonu", date:"Nisan 2023",
    summary:"GRU'nun Türkiye-Ukrayna arasında silah taşıdığı değerlendirilen TIR'ları ticari uydu ve insan kaynakları aracılığıyla izlediği Bellingcat araştırmasıyla ortaya konuldu.",
    sources:[{label:"Bellingcat – Russia tracking weapons",url:"https://www.bellingcat.com"},{label:"Conflict Armament Research",url:"https://www.conflictarm.com"}],
    categories:["cat-fsb","cat-rusya","cat-turkiye","cat-siber"] },
  { id:"ev-018", label:"İsrail Lübnan Hezbollah İstihbarat Sızıntısı", date:"Mart 2023",
    summary:"Güney Lübnan'daki Hezbollah mevzilerini tespit etmekte kullanılan İsrail insan kaynakları ağının bir bölümünün Hezbollah kontr-istihbarat birimi tarafından deşifre edildiği teyit edildi.",
    sources:[{label:"Jerusalem Post – IDF intelligence Lebanon",url:"https://www.jpost.com"},{label:"Ynet – Hezbollah counter-intel",url:"https://www.ynet.co.il"}],
    categories:["cat-mossad","cat-israel","cat-iran","cat-humint"] },
  { id:"ev-019", label:"İran Avrupa Muhalefet Suikast Planı", date:"Haziran 2023",
    summary:"AIVD, BfV ve BVT'nin ortak değerlendirmeleri VEVAK'ın Avrupa'daki İranlı muhalefet liderlerine yönelik aktif suikast planları hazırladığını belgeledi.",
    sources:[{label:"AIVD – Annual Review 2023",url:"https://www.aivd.nl"},{label:"BfV – Iran threat assessment",url:"https://www.verfassungsschutz.de"}],
    categories:["cat-iran-intel","cat-iran","cat-humint"] },
  { id:"ev-020", label:"İstanbul Havalimanı Gözetim Hücresi", date:"Ağustos 2023",
    summary:"Türk kontr-istihbarat birimlerinin İstanbul Havalimanı'nda Mossad adına profilleme faaliyeti yürüttüğünden şüphelenilen bir hücreyi çökertttiği bildirildi.",
    sources:[{label:"A Haber – MİT İstanbul operasyonu",url:"https://www.ahaber.com.tr"},{label:"Milliyet – Havalimanı istihbarat vakası",url:"https://www.milliyet.com.tr"}],
    categories:["cat-mossad","cat-turkiye","cat-israel","cat-siber"] },
  { id:"ev-021", label:"CIA Pakistan Drone İstihbarat Programı", date:"Eylül 2023",
    summary:"CIA'in Pakistan-Afganistan sınır bölgesindeki drone gözetim programı Kongre soruşturmasına konu oldu; Pakistan ISI ile seçici istihbarat paylaşımı çerçevesinde işletildiği ortaya konuldu.",
    sources:[{label:"Congressional Research Service – CRS R47780",url:"https://crsreports.congress.gov"},{label:"Dawn – CIA drone programme Pakistan",url:"https://www.dawn.com"}],
    categories:["cat-cia","cat-abd","cat-siber"] },
  { id:"ev-022", label:"FSB Türk Diplomatlarına Yaklaşım Girişimi", date:"Kasım 2023",
    summary:"Moskova'daki ticaret fuarında FSB istihbaratçısı olduğu değerlendirilen bir kişinin Türk büyükelçilik personeline yaklaşmaya çalışması üzerine persona non grata ilan edildi.",
    sources:[{label:"Hürriyet – Diplomatik nota Moskova",url:"https://www.hurriyet.com.tr"},{label:"Milliyet – Dışişleri açıklaması",url:"https://www.milliyet.com.tr"}],
    categories:["cat-fsb","cat-rusya","cat-turkiye","cat-humint"] },
  { id:"ev-023", label:"İran-Irak Çift Kullanımlı Teknoloji Kaçakçılığı", date:"Ocak 2024",
    summary:"MİT ve Gümrük Muhafaza'nın ortak operasyonu, İran'dan Irak üzerinden Türkiye'ye sokulan ileri elektronik bileşenleri tespit etti.",
    sources:[{label:"UNODC – Arms and Tech Trafficking 2024",url:"https://www.unodc.org"},{label:"Ticaret Bakanlığı – İhracat Kontrol Bülteni",url:"https://www.ticaret.gov.tr"}],
    categories:["cat-iran-intel","cat-iran","cat-turkiye","cat-siber"] },
  { id:"ev-024", label:"Kıbrıs Egemen Üslerinden SIGINT Operasyonu", date:"Mayıs 2023",
    summary:"Kıbrıs'taki İngiliz egemen üslerinin İsrail 8200 Birliği ile koordineli biçimde Doğu Akdeniz'deki İran deniz trafiğini ve Hizbullah iletişimlerini izlediği belgelendi.",
    sources:[{label:"The Times – Cyprus British bases SIGINT",url:"https://www.thetimes.co.uk"},{label:"RUSI – Eastern Mediterranean intelligence",url:"https://www.rusi.org"}],
    categories:["cat-mossad","cat-mi6","cat-israel","cat-iran","cat-siber"] },
  { id:"ev-025", label:"MI6 Türkiye-Suriye Sınır Ajan Ağı", date:"Temmuz 2023",
    summary:"MI6'nın Türkiye-Suriye sınır bölgesinde IŞİL kalıntı gruplarını ve İran destekli milis güçlerini takip eden yerel insan kaynakları ağı geliştirdiği NATO kaynaklı değerlendirmelerde yer aldı.",
    sources:[{label:"IISS – Syria Intelligence Landscape 2023",url:"https://www.iiss.org"},{label:"Al-Monitor – Border intelligence Turkey Syria",url:"https://www.al-monitor.com"}],
    categories:["cat-mi6","cat-turkiye","cat-iran","cat-humint"] },
  { id:"ev-026", label:"İran ASELSAN-Roketsan Siber Casusluğu", date:"Şubat 2024",
    summary:"APT42 grubunun ASELSAN, Roketsan ve HAVELSAN'ı hedef alan spear-phishing saldırıları gerçekleştirdiği; hassas savunma belgelerinin ele geçirilmiş olabileceği Mandiant raporuyla belgelendi.",
    sources:[{label:"Mandiant – APT42 Activity Report",url:"https://www.mandiant.com/resources/reports/apt42"},{label:"SSB Siber Güvenlik Açıklaması",url:"https://www.ssb.gov.tr"}],
    categories:["cat-iran-intel","cat-iran","cat-turkiye","cat-siber"] },
  { id:"ev-027", label:"CIA-MİT Suriye İstihbarat Ortaklığı", date:"Eylül 2023",
    summary:"CIA ve MİT'in Kuzey Suriye'deki IŞİL varlığı ve PKK/YPG faaliyetlerine ilişkin operasyonel istihbaratı belirli protokoller çerçevesinde paylaştığı doğrulandı.",
    sources:[{label:"Reuters – CIA MIT cooperation Syria",url:"https://www.reuters.com"},{label:"Foreign Policy – Turkey US intelligence sharing",url:"https://foreignpolicy.com"}],
    categories:["cat-cia","cat-abd","cat-turkiye","cat-humint"] },
  { id:"ev-028", label:"Rusya İstanbul Boğazı Deniz Gözetleme", date:"Ekim 2023",
    summary:"GRU bağlantılı teknelerin İstanbul Boğazı'ndan geçen NATO savaş gemilerini sivil kıyafetli gözlemciler ve özel sensörlü teknelerle katalogladığı Türk Deniz Kuvvetleri tarafından tespit edildi.",
    sources:[{label:"USNI News – Russia Black Sea surveillance",url:"https://www.usni.org"},{label:"Savunma Sanayii Dergisi – Boğaz güvenliği",url:"https://www.savunmasanayii.com"}],
    categories:["cat-fsb","cat-rusya","cat-turkiye","cat-siber"] },
];

/* ─────────────────────────────────────────────
   UCDP VERİSİNİ SPYGRAPH OLAYINA DÖNÜŞTÜR
───────────────────────────────────────────── */
function ucdpToEvent(ev: NonNullable<SpyGraphProps["ucdpEvents"]>[0], idx: number): SpyEvent {
  return {
    id: `live-ucdp-${idx}`,
    label: ev.conflict_name || `UCDP #${ev.id}`,
    date: ev.date || "Bilinmiyor",
    summary: `${ev.country} — ${ev.violence_label}. ${ev.side_a} × ${ev.side_b}. En iyi ölü tahmini: ${ev.deaths_best}.`,
    sources: [{ label: "UCDP GED Candidate Events", url: "https://ucdpapi.pcr.uu.se" }],
    categories: ["cat-live-ucdp"],
    live: true,
  };
}

function newsToEvent(item: NonNullable<SpyGraphProps["newsItems"]>[0], idx: number): SpyEvent {
  return {
    id: `live-news-${idx}`,
    label: (item.title || "Başlıksız Haber").substring(0, 48),
    date: item.published ? new Date(item.published).toLocaleDateString("tr-TR") : "Bilinmiyor",
    summary: item.title || "",
    sources: item.url ? [{ label: item.source || "Haber", url: item.url }] : [],
    categories: ["cat-live-news"],
    live: true,
  };
}

/* ─────────────────────────────────────────────
   ANA BİLEŞEN
───────────────────────────────────────────── */
const SpyGraph: React.FC<SpyGraphProps> = ({
  isOpen,
  onClose,
  ucdpEvents = [],
  newsItems = [],
}) => {
  const cyContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cyRef = useRef<any>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailData | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; date: string } | null>(null);
  const [ready, setReady] = useState(false);

  /* Tüm olayları birleştir */
  const allEvents = useMemo<SpyEvent[]>(() => {
    const liveUcdp = ucdpEvents.slice(0, 30).map(ucdpToEvent);
    const liveNews = newsItems
      .filter((n) => (n.risk_score ?? 0) >= 3)
      .slice(0, 20)
      .map(newsToEvent);
    return [...STATIC_EVENTS, ...liveUcdp, ...liveNews];
  }, [ucdpEvents, newsItems]);

  /* Görünür kategoriler */
  const visibleCategories = useMemo<SpyCategory[]>(() => {
    const usedIds = new Set(allEvents.flatMap((e) => e.categories));
    return CATEGORIES.filter((c) => usedIds.has(c.id));
  }, [allEvents]);

  /* ── Cytoscape başlatma ── */
  const initCy = useCallback(async () => {
    if (!cyContainerRef.current || !isOpen) return;
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }

    // Dynamic import — SSR yok
    const cytoscape = (await import("cytoscape")).default;
    // @ts-expect-error — cose-bilkent tip tanımı yok
    const coseBilkent = (await import("cytoscape-cose-bilkent")).default;
    try { cytoscape.use(coseBilkent); } catch { /* zaten kayıtlı */ }

    /* Düğüm + kenar verisi */
    const elements: object[] = [];

    // Kategori düğümleri
    visibleCategories.forEach((cat) => {
      elements.push({
        data: { id: cat.id, label: cat.label, type: "category" },
      });
    });

    // Olay düğümleri + kenarlar
    allEvents.forEach((ev) => {
      elements.push({
        data: {
          id: ev.id,
          label: ev.label,
          date: ev.date,
          summary: ev.summary,
          sources: JSON.stringify(ev.sources),
          categories: JSON.stringify(ev.categories),
          type: "event",
          live: ev.live ? "1" : "0",
        },
      });
      ev.categories.forEach((catId) => {
        const catExists = visibleCategories.some((c) => c.id === catId);
        if (catExists) {
          elements.push({
            data: {
              id: `${ev.id}__${catId}`,
              source: ev.id,
              target: catId,
            },
          });
        }
      });
    });

    cyRef.current = cytoscape({
      container: cyContainerRef.current,
      elements,
      style: [
        /* Olay düğümleri */
        { selector: 'node[type="event"]', style: {
          "background-color": "#cbd5e1",
          "border-color": "#64748b",
          "border-width": 1.5,
          width: 16, height: 16,
          label: "",
          "shadow-blur": 8, "shadow-color": "#e2e8f055",
          "shadow-offset-x": 0, "shadow-offset-y": 0, "shadow-opacity": 0.7,
          "transition-property": "background-color, border-color, width, height, opacity",
          "transition-duration": "200ms",
        }},
        /* Canlı olay düğümleri */
        { selector: 'node[type="event"][live="1"]', style: {
          "background-color": "#fbbf24",
          "border-color": "#f59e0b",
          "border-width": 2,
          "shadow-color": "#f59e0b",
          "shadow-blur": 12, "shadow-opacity": 0.6,
        }},
        /* Kategori düğümleri */
        { selector: 'node[type="category"]', style: {
          "background-color": "#15803d",
          "border-color": "#22c55e",
          "border-width": 2.5,
          width: 32, height: 32,
          label: "data(label)",
          "text-valign": "bottom", "text-halign": "center",
          "font-size": "9.5px",
          color: "#4ade80",
          "font-family": "Courier New, monospace",
          "font-weight": "bold",
          "text-margin-y": 6,
          "text-outline-color": "#04080f", "text-outline-width": 2,
          "shadow-blur": 18, "shadow-color": "#22c55e",
          "shadow-offset-x": 0, "shadow-offset-y": 0, "shadow-opacity": 0.55,
          "transition-property": "background-color, border-color, width, height, opacity",
          "transition-duration": "200ms",
        }},
        /* Canlı kategori düğümleri */
        { selector: 'node#cat-live-ucdp, node#cat-live-news', style: {
          "background-color": "#92400e",
          "border-color": "#fbbf24",
          "shadow-color": "#fbbf24",
        }},
        /* Kenarlar */
        { selector: "edge", style: {
          width: 0.7, "line-color": "#0f2a1a",
          opacity: 0.55, "curve-style": "bezier",
          "transition-property": "line-color, opacity, width",
          "transition-duration": "200ms",
        }},
        /* Vurgulanan olay */
        { selector: 'node.highlighted[type="event"]', style: {
          "background-color": "#f1f5f9",
          "border-color": "#22c55e", "border-width": 2,
          width: 22, height: 22,
          "shadow-blur": 14, "shadow-color": "#22c55e", "shadow-opacity": 0.5,
          opacity: 1,
        }},
        /* Vurgulanan kategori */
        { selector: 'node.highlighted[type="category"]', style: {
          "background-color": "#16a34a",
          "border-color": "#4ade80",
          width: 38, height: 38,
          "shadow-blur": 24, "shadow-opacity": 0.75, opacity: 1,
        }},
        /* Seçili düğüm */
        { selector: "node:selected", style: {
          "border-color": "#67e8f9", "border-width": 3,
          "shadow-color": "#67e8f9", "shadow-blur": 20, "shadow-opacity": 0.8,
        }},
        /* Soluk */
        { selector: ".dimmed", style: { opacity: 0.07 }},
        /* Vurgulanan kenar */
        { selector: "edge.highlighted", style: {
          "line-color": "#22c55e44", opacity: 0.4, width: 1.2,
        }},
      ],
      layout: {
        name: "cose-bilkent",
        animate: true,
        animationDuration: 900,
        randomize: true,
        nodeRepulsion: 8500,
        idealEdgeLength: 120,
        edgeElasticity: 0.45,
        nestingFactor: 0.1,
        gravity: 0.25,
        numIter: 2500,
        tile: true,
        tilingPaddingVertical: 10,
        tilingPaddingHorizontal: 10,
      },
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
      minZoom: 0.15,
      maxZoom: 4,
    });

    const cy = cyRef.current;

    /* Tıklama → detay paneli */
    cy.on("tap", 'node[type="event"]', (e: any) => {
      const d = e.target.data();
      let srcs: { label: string; url: string }[] = [];
      let cats: string[] = [];
      try { srcs = JSON.parse(d.sources || "[]"); } catch { /* */ }
      try { cats = JSON.parse(d.categories || "[]"); } catch { /* */ }
      setDetail({ id: d.id, label: d.label, date: d.date, summary: d.summary, sources: srcs, categories: cats, live: d.live === "1" });
    });

    cy.on("tap", 'node[type="category"]', (e: any) => {
      handleCategoryFilter(e.target.id(), cy);
    });

    cy.on("tap", (e: any) => {
      if (e.target === cy) { resetFilter(cy); setDetail(null); }
    });

    /* Hover tooltip */
    cy.on("mouseover", "node", (e: any) => {
      const d = e.target.data();
      if (d.type !== "event") return;
      const pos = e.renderedPosition;
      setTooltip({ x: pos.x + 14, y: pos.y - 10, label: d.label, date: d.date });
    });
    cy.on("mouseout", "node", () => setTooltip(null));

    setReady(true);
  }, [isOpen, allEvents, visibleCategories]);

  useEffect(() => {
    if (isOpen) {
      const t = setTimeout(initCy, 80);
      return () => clearTimeout(t);
    } else {
      if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
      setReady(false);
      setDetail(null);
      setTooltip(null);
      setSearchQuery("");
      setActiveCategory(null);
    }
  }, [isOpen, initCy]);

  /* ── Graf filtreleme ── */
  const handleCategoryFilter = useCallback((catId: string, cy: any) => {
    if (activeCategory === catId) { resetFilter(cy); return; }
    setActiveCategory(catId);

    cy.nodes().removeClass("dimmed highlighted hovered");
    cy.edges().removeClass("dimmed highlighted");

    const catNode = cy.getElementById(catId);
    const connectedEvents = catNode.neighborhood('node[type="event"]');
    const connectedEdges = catNode.connectedEdges();

    cy.nodes().not(catNode).not(connectedEvents).addClass("dimmed");
    cy.edges().not(connectedEdges).addClass("dimmed");
    catNode.addClass("highlighted");
    connectedEvents.addClass("highlighted");
    connectedEdges.addClass("highlighted");
  }, [activeCategory]);

  const resetFilter = useCallback((cy: any) => {
    if (!cy) return;
    setActiveCategory(null);
    cy.nodes().removeClass("dimmed highlighted hovered");
    cy.edges().removeClass("dimmed highlighted");
    cy.nodes().unselect();
  }, []);

  /* ── Arama ── */
  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    const cy = cyRef.current;
    if (!cy) return;
    if (!q.trim()) { resetFilter(cy); return; }
    setActiveCategory(null);
    const ql = q.toLowerCase();
    cy.nodes().each((node: any) => {
      const l = (node.data("label") || "").toLowerCase();
      const s = (node.data("summary") || "").toLowerCase();
      node.removeClass("dimmed highlighted");
      if (l.includes(ql) || s.includes(ql)) node.addClass("highlighted");
      else node.addClass("dimmed");
    });
    cy.edges().each((edge: any) => {
      const ok = edge.source().hasClass("highlighted") && edge.target().hasClass("highlighted");
      edge.removeClass("dimmed highlighted");
      if (ok) edge.addClass("highlighted"); else edge.addClass("dimmed");
    });
  }, [resetFilter]);

  if (!isOpen) return null;

  const liveCount = allEvents.filter((e) => e.live).length;
  const staticCount = allEvents.filter((e) => !e.live).length;

  return (
    <div className="fixed inset-0 z-[500] flex flex-col" style={{ background: "#04080f", fontFamily: "'Courier New', monospace" }}>

      {/* ── HEADER ── */}
      <header style={{ background: "rgba(4,8,15,0.97)", borderBottom: "1px solid rgba(34,197,94,0.12)" }}
        className="flex-none px-4 pt-2.5 pb-2 z-10">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Logo */}
          <div className="flex-none">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2 h-2 rounded-full bg-green-500"
                style={{ animation: "blink 1.1s step-end infinite", boxShadow: "0 0 6px #22c55e" }} />
              <Network size={14} className="text-green-400" />
              <span className="text-green-400 font-bold text-sm tracking-[0.25em]"
                style={{ animation: "glow-pulse 2.8s ease-in-out infinite", textShadow: "0 0 8px rgba(34,197,94,0.4)" }}>
                SpyGraph
              </span>
              <span style={{ color: "#374151", fontSize: 10, letterSpacing: "0.12em" }}>OSINT İSTİHBARAT AĞI</span>
            </div>
          </div>

          {/* Arama */}
          <div className="relative flex-none">
            <svg style={{ position: "absolute", left: 8, top: "50%", transform: "translateY(-50%)", width: 12, height: 12, color: "#374151" }}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text" value={searchQuery} placeholder="Olay veya kategori ara…"
              onChange={(e) => handleSearch(e.target.value)}
              style={{
                fontSize: 11, padding: "5px 10px 5px 26px", borderRadius: 4, width: 200,
                background: "rgba(4,8,15,0.8)", border: "1px solid rgba(34,197,94,0.2)",
                color: "#d1d5db", outline: "none",
              }}
            />
          </div>

          {/* Sıfırla */}
          <button onClick={() => { handleSearch(""); setDetail(null); }}
            style={{ fontSize: 10, padding: "5px 10px", borderRadius: 4, border: "1px solid rgba(239,68,68,0.25)", color: "rgba(239,68,68,0.6)", background: "transparent", cursor: "pointer" }}>
            ✕ Sıfırla
          </button>

          {/* İstatistikler */}
          <div className="ml-auto hidden sm:flex items-center gap-4" style={{ fontSize: 10, color: "#374151" }}>
            <span><span style={{ color: "#e2e8f0" }}>{staticCount}</span> Statik</span>
            {liveCount > 0 && <span><span style={{ color: "#fbbf24" }}>{liveCount}</span> Canlı</span>}
            <span><span style={{ color: "#22c55e" }}>{visibleCategories.length}</span> Kategori</span>
            <span style={{ color: "#1f2937" }}>|</span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500"
                style={{ animation: "blink 1.1s step-end infinite" }} />
              <span style={{ color: "#ef4444", letterSpacing: "0.1em" }}>CANLI</span>
            </span>
            <button onClick={onClose}
              className="ml-3 flex items-center gap-1 px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors">
              <X size={11} />
              <span>Kapat</span>
            </button>
          </div>
          <button onClick={onClose} className="sm:hidden text-zinc-400 hover:text-zinc-200 ml-auto"><X size={16} /></button>
        </div>

        {/* Kategori chip'leri */}
        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span style={{ fontSize: 9, color: "#1f2937", letterSpacing: "0.1em", marginRight: 4 }}>FİLTRE:</span>
          {visibleCategories.map((cat) => (
            <button key={cat.id}
              onClick={() => { if (cyRef.current) handleCategoryFilter(cat.id, cyRef.current); }}
              style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 3,
                cursor: "pointer", whiteSpace: "nowrap", fontFamily: "Courier New, monospace",
                border: `1px solid ${activeCategory === cat.id ? "#22c55e" : "rgba(34,197,94,0.2)"}`,
                background: activeCategory === cat.id ? "rgba(34,197,94,0.12)" : "transparent",
                color: activeCategory === cat.id ? "#22c55e" : "#4b5563",
                boxShadow: activeCategory === cat.id ? "0 0 8px rgba(34,197,94,0.2)" : "none",
                transition: "all 0.18s",
              }}>
              {cat.label}
            </button>
          ))}
        </div>
      </header>

      {/* ── ANA ALAN ── */}
      <main className="flex-1 flex relative overflow-hidden" style={{ minHeight: 0 }}>

        {/* Siber grid arka planı */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: `linear-gradient(rgba(34,197,94,0.035) 1px, transparent 1px) 0 0 / 48px 48px,
            linear-gradient(90deg, rgba(34,197,94,0.035) 1px, transparent 1px) 0 0 / 48px 48px,
            radial-gradient(ellipse 80% 70% at 50% 50%, #071220 0%, #04080f 100%)`,
          zIndex: 0,
        }} />
        {/* CRT scanline */}
        <div className="absolute inset-0 pointer-events-none opacity-[0.04]" style={{
          zIndex: 2,
          background: "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.1) 3px, rgba(0,0,0,0.1) 4px)",
        }} />

        {/* Cytoscape canvas */}
        <div ref={cyContainerRef} className="absolute inset-0" style={{ zIndex: 1 }} />

        {/* Yükleniyor */}
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="text-center" style={{ color: "#22c55e", fontSize: 11, letterSpacing: "0.2em" }}>
              <div className="mb-3 w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <span>NETWORK RENDERING…</span>
            </div>
          </div>
        )}

        {/* Tooltip */}
        {tooltip && (
          <div style={{
            position: "absolute", left: tooltip.x, top: tooltip.y,
            background: "rgba(4,8,15,0.92)", border: "1px solid rgba(34,197,94,0.35)",
            borderRadius: 4, padding: "5px 10px", zIndex: 9999, pointerEvents: "none",
            backdropFilter: "blur(8px)", maxWidth: 200,
          }}>
            <div style={{ fontSize: 11, color: "#e2e8f0", fontWeight: "bold", letterSpacing: "0.05em" }}>{tooltip.label}</div>
            <div style={{ fontSize: 9, color: "#22c55e", marginTop: 2 }}>{tooltip.date}</div>
          </div>
        )}

        {/* Zoom kontrolleri */}
        <div style={{ position: "absolute", bottom: 16, left: 16, display: "flex", flexDirection: "column", gap: 4, zIndex: 10 }}>
          {[
            { icon: <ZoomIn size={14} />, action: () => cyRef.current?.zoom(cyRef.current.zoom() * 1.25), label: "+" },
            { icon: <ZoomOut size={14} />, action: () => cyRef.current?.zoom(cyRef.current.zoom() * 0.8), label: "-" },
            { icon: <Maximize2 size={12} />, action: () => cyRef.current?.fit(undefined, 40), label: "F" },
            { icon: <RotateCcw size={11} />, action: () => { if (cyRef.current) { resetFilter(cyRef.current); setDetail(null); setSearchQuery(""); } }, label: "R" },
          ].map((btn, i) => (
            <button key={i} onClick={btn.action} style={{
              width: 30, height: 30, background: "rgba(4,8,15,0.85)",
              border: "1px solid rgba(34,197,94,0.25)", color: "#22c55e",
              borderRadius: 4, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
              backdropFilter: "blur(6px)", transition: "border-color 0.15s, background 0.15s",
            }}>{btn.icon}</button>
          ))}
        </div>

        {/* Legand */}
        <div style={{ position: "absolute", bottom: 16, right: detail ? 340 : 16, zIndex: 10,
          background: "rgba(4,8,15,0.85)", border: "1px solid rgba(34,197,94,0.15)",
          borderRadius: 4, padding: "6px 10px", transition: "right 0.32s cubic-bezier(0.16,1,0.3,1)" }}>
          <div style={{ fontSize: 9, color: "#374151", letterSpacing: "0.1em", marginBottom: 4 }}>GÖSTERGE</div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#cbd5e1", border: "1.5px solid #64748b", flexShrink: 0 }} />
              <span style={{ fontSize: 9, color: "#94a3b8" }}>Statik Olay</span>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#fbbf24", border: "2px solid #f59e0b", flexShrink: 0, boxShadow: "0 0 6px #f59e0b88" }} />
              <span style={{ fontSize: 9, color: "#94a3b8" }}>Canlı Veri</span>
            </div>
            <div className="flex items-center gap-2">
              <div style={{ width: 16, height: 16, borderRadius: "50%", background: "#15803d", border: "2.5px solid #22c55e", flexShrink: 0, boxShadow: "0 0 8px #22c55e66" }} />
              <span style={{ fontSize: 9, color: "#94a3b8" }}>Kategori</span>
            </div>
          </div>
        </div>

        {/* ── DETAY PANELİ ── */}
        <div style={{
          position: "absolute", right: 0, top: 0, bottom: 0, width: 320,
          background: "rgba(4,8,15,0.97)", borderLeft: "1px solid rgba(34,197,94,0.15)",
          transform: detail ? "translateX(0)" : "translateX(105%)",
          transition: "transform 0.32s cubic-bezier(0.16,1,0.3,1)",
          zIndex: 20, overflowY: "auto", padding: "0 0 20px 0",
        }}>
          {detail && (
            <>
              {/* Panel header */}
              <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(34,197,94,0.1)", position: "sticky", top: 0, background: "rgba(4,8,15,0.98)", zIndex: 1 }}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {detail.live && (
                      <span style={{ fontSize: 8, background: "rgba(251,191,36,0.15)", border: "1px solid #fbbf2466", color: "#fbbf24", borderRadius: 2, padding: "1px 5px", letterSpacing: "0.1em", marginBottom: 4, display: "inline-block" }}>
                        ● CANLI
                      </span>
                    )}
                    <div style={{ fontSize: 12, color: "#f1f5f9", fontWeight: "bold", letterSpacing: "0.05em", lineHeight: 1.3, marginTop: 2 }}>
                      {detail.label}
                    </div>
                    <div style={{ fontSize: 9, color: "#22c55e", marginTop: 3 }}>{detail.date}</div>
                  </div>
                  <button onClick={() => setDetail(null)} style={{ color: "#374151", background: "none", border: "none", cursor: "pointer", flexShrink: 0, padding: 2 }}>
                    <X size={14} />
                  </button>
                </div>
              </div>

              {/* Kategoriler */}
              <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(34,197,94,0.07)" }}>
                <div style={{ fontSize: 8, color: "#1f2937", letterSpacing: "0.12em", marginBottom: 6 }}>KATEGORİLER</div>
                <div className="flex flex-wrap gap-1">
                  {detail.categories.map((catId) => {
                    const cat = CATEGORIES.find((c) => c.id === catId);
                    return cat ? (
                      <button key={catId}
                        onClick={() => { if (cyRef.current) handleCategoryFilter(catId, cyRef.current); }}
                        style={{ fontSize: 9, padding: "2px 7px", borderRadius: 2, border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80", background: "rgba(34,197,94,0.07)", cursor: "pointer" }}>
                        {cat.label}
                      </button>
                    ) : null;
                  })}
                </div>
              </div>

              {/* Özet */}
              <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(34,197,94,0.07)" }}>
                <div style={{ fontSize: 8, color: "#1f2937", letterSpacing: "0.12em", marginBottom: 6 }}>ÖZET</div>
                <p style={{ fontSize: 10, color: "#94a3b8", lineHeight: 1.65 }}>{detail.summary}</p>
              </div>

              {/* Kaynaklar */}
              {detail.sources.length > 0 && (
                <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(34,197,94,0.07)" }}>
                  <div style={{ fontSize: 8, color: "#1f2937", letterSpacing: "0.12em", marginBottom: 6 }}>KAYNAKLAR</div>
                  <div className="flex flex-col gap-1.5">
                    {detail.sources.map((src, i) => (
                      <a key={i} href={src.url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 9.5, color: "#22c55e", textDecoration: "none", borderBottom: "1px solid rgba(34,197,94,0.25)", wordBreak: "break-all", lineHeight: 1.4, paddingBottom: 2 }}>
                        ↗ {src.label}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* İlgili olaylar */}
              <div style={{ padding: "10px 14px" }}>
                <div style={{ fontSize: 8, color: "#1f2937", letterSpacing: "0.12em", marginBottom: 6 }}>İLGİLİ OLAYLAR</div>
                <div className="flex flex-col gap-1">
                  {allEvents
                    .filter((ev) => ev.id !== detail.id && ev.categories.some((c) => detail.categories.includes(c)))
                    .slice(0, 5)
                    .map((ev) => (
                      <button key={ev.id}
                        onClick={() => {
                          setDetail({ id: ev.id, label: ev.label, date: ev.date, summary: ev.summary, sources: ev.sources, categories: ev.categories, live: ev.live });
                          const node = cyRef.current?.getElementById(ev.id);
                          if (node?.length) {
                            cyRef.current.animate({ center: { eles: node }, zoom: Math.max(cyRef.current.zoom(), 1.2) }, { duration: 500 });
                          }
                        }}
                        style={{ textAlign: "left", padding: "4px 8px", borderRadius: 3, border: "1px solid rgba(34,197,94,0.12)", background: "transparent", cursor: "pointer", transition: "all 0.15s" }}>
                        <div style={{ fontSize: 9, color: "#94a3b8" }}>{ev.label}</div>
                        <div style={{ fontSize: 8, color: "#374151" }}>{ev.date}</div>
                      </button>
                    ))}
                </div>
              </div>
            </>
          )}
        </div>
      </main>

      {/* CSS animasyonları */}
      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
        @keyframes glow-pulse { 0%,100%{text-shadow:0 0 8px rgba(34,197,94,0.4)} 50%{text-shadow:0 0 18px rgba(34,197,94,0.9),0 0 35px rgba(34,197,94,0.3)} }
      `}</style>
    </div>
  );
};

export default SpyGraph;
