/*
 * app.js — Kilaža & Trening (samostalna aplikacija).
 *
 * Izdvojeno iz Fokus aplikacije: praćenje kilaže (grafik + cilj), obroka
 * (kalorije i makroi) i treninga (dnevnik sesija sa težinom i beleškama).
 *
 * Deli isti backend (Supabase) i iste ključeve podataka kao Fokus, pa se
 * postojeći uneti treninzi/obroci/kilaža automatski vide i ovde. Sve sinhrone
 * funkcije rade nad memorijskim kešom koji storage.js napuni pri pokretanju.
 *
 * Redosled u fajlu: konstante → stanje → datumi/format → DOM pomoćne →
 * navigacija → (kilaža + obroci + trening render/logika, preuzeto iz Fokusa) →
 * istorija i detalj dana → init.
 */

/* ===================== KONSTANTE ===================== */

const DANI = ["Nedelja", "Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota"];
const DANI_KRATKO = ["NED", "PON", "UTO", "SRE", "ČET", "PET", "SUB"];
const MESECI = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];

// Reč uz težinu trening-sesije (indeks = broj tegova 1–5).
const TRENING_LABELE = ["", "Lako", "Umereno", "Solidno", "Naporno", "Maksimalno"];

// Putanje inline SVG ikonica (bučica i pribor za jelo), crtaju se preko ikonaSvg.
const IKONA_TEG = "M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12";
const IKONA_OBROK = "M6 3v8a2 2 0 0 0 4 0V3M8 11v10M18 3c-1.7 1-2.5 3-2.5 5.5S16.3 13 18 13v8";

// Brojčana polja forme za obrok: [labela, ključ u draftu, CSS klasa polja].
// Isti spisak crta polja i vezuje ih za draft, pa ne mogu da se raziđu.
const OBROK_POLJA = [
  ["kcal", "kcal", "obrok-kcal"],
  ["P (g)", "protein", "obrok-protein"],
  ["UH (g)", "ugljeni", "obrok-ugljeni"],
  ["M (g)", "masti", "obrok-masti"]
];

/* ===================== STANJE UI ===================== */

const stanje = {
  sekcija: "kilaza",          // kilaza | treninzi | trening | istorija | detalj
  kilazaOpseg: "30d",         // opseg grafika kilaže: 7d | 30d | sve
  kilazaDraft: null,          // vrednost u steperu (kg) pre čuvanja; null = tek otvoreno
  kilazaSacuvano: false,      // prolazno: "Sačuvano ✓" posle upisa
  treningTezina: 3,           // težina (1–5) izabrana u formi za novi trening
  treningDatum: null,         // datum treninga otvorenog na Trening (detalj) ekranu
  treningId: null,            // id treninga otvorenog na Trening (detalj) ekranu
  treningNazad: "detalj",     // kuda vodi "nazad" sa Trening detalja (detalj | treninzi)
  mesecOffset: 0,             // pomeraj meseca na Istoriji (0 = tekući, -1 = prošli…)
  detaljDatum: null,          // datum otvoren na ekranu Detalj dana
  obrokDraft: { opis: "", kcal: "", protein: "", ugljeni: "", masti: "" }
};

/* ===================== DATUMI I FORMAT ===================== */

// "YYYY-MM-DD" iz Date, u LOKALNOJ zoni (ne toISOString jer radi u UTC).
function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dan = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${dan}`;
}

const danasKey = () => dateKey(new Date());

// Jedinstven id (vreme + slučajni deo) — dovoljno za jednokorisničku app.
const noviId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function datumIzKljuca(kljuc) {
  const [g, m, d] = kljuc.split("-");
  return new Date(Number(g), Number(m) - 1, Number(d));
}

// Pomera datum-ključ za dati broj dana (npr. -1 za juče).
function pomeriDatum(kljuc, brojDana) {
  const d = datumIzKljuca(kljuc);
  d.setDate(d.getDate() + brojDana);
  return dateKey(d);
}

// "2026-07-04" → "Subota, 4. jul"
function imeDatuma(kljuc) {
  const d = datumIzKljuca(kljuc);
  return `${DANI[d.getDay()]}, ${d.getDate()}. ${MESECI[d.getMonth()]}`;
}

// "2026-07-04" → "4. jul" (za oznake na grafiku i naslov stepera).
function kratakDatum(kljuc) {
  const d = datumIzKljuca(kljuc);
  return `${d.getDate()}. ${MESECI[d.getMonth()]}`;
}

// Minuti → "3h 53m", "45m" ili "0m" (za zbirove vremena).
function formatTrajanje(minuti) {
  const ukupno = Math.round(minuti);
  const h = Math.floor(ukupno / 60);
  const m = ukupno % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// "09:00" → broj minuta od ponoći (540).
function vremeUMinute(tekst) {
  const [h, m] = tekst.split(":");
  return Number(h) * 60 + Number(m);
}

// "1.850 kcal" — hiljade sa tačkom da se veliki brojevi lakše čitaju.
const formatKcal = (n) => Math.round(n).toLocaleString("sr-RS");

// Grami: bez decimala ("42 g"), jer se unose kao celi brojevi.
const formatGrami = (n) => `${Math.round(n)} g`;

// Kilaža → "72,4" (srpski decimalni zapis).
const formatKg = (v) => v.toFixed(1).replace(".", ",");

// Sprečava ubacivanje HTML-a kroz nazive koje korisnik unosi. Zamena po tabeli
// (bez pomoćnog DOM elementa) — pokriva i navodnike, pa je bezbedno i unutar
// atributa (value="…").
const HTML_ZAMENE = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (tekst) => String(tekst).replace(/[&<>"']/g, (z) => HTML_ZAMENE[z]);

/* ===================== DOM POMOĆNE ===================== */

// Kratice za obrasce koji se ponavljaju u svakoj render funkciji.
const el = (id) => document.getElementById(id);

// Kači "click" handler na sve elemente koji odgovaraju selektoru unutar
// kontejnera. Element na koji je handler zakačen je e.currentTarget.
function poveziKlik(kontejner, selektor, handler) {
  kontejner.querySelectorAll(selektor).forEach((cvor) => cvor.addEventListener("click", handler));
}

// Inline SVG ikonica: ista osnova (24×24, obris u currentColor, zaobljeni
// krajevi) za sve ikone; "dodatno" nosi atribute specifične za jednu putanju.
const ikonaSvg = (klasa, putanja, dodatno) =>
  `<svg class="${klasa}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round"${dodatno || ""}><path d="${putanja}"/></svg>`;

const treningIkonaSvg = () => ikonaSvg("teg-ikona", IKONA_TEG);
const obrokIkonaSvg = () => ikonaSvg("obrok-ikona", IKONA_OBROK, ' stroke-linejoin="round"');

/* ===================== NAVIGACIJA ===================== */

// Prikazuje jednu sekciju (ekran), krije ostale i osveži njen sadržaj.
function prikaziSekciju(naziv) {
  stanje.sekcija = naziv;

  document.querySelectorAll("main > section").forEach((sekcija) => {
    sekcija.hidden = sekcija.id !== "sekcija-" + naziv;
  });

  // Svaki ulazak na Kilažu kreće sa skupljenim/neizmenjenim steperom.
  if (naziv === "kilaza") {
    stanje.kilazaDraft = null;
    stanje.kilazaSacuvano = false;
  }

  // Bottom nav: pod-ekrani ostaju pod svojim tabom.
  let navTab = naziv;
  if (naziv === "trening") navTab = "treninzi";
  if (naziv === "detalj") navTab = "istorija";
  document.querySelectorAll(".nav-dugme").forEach((dugme) => {
    dugme.classList.toggle("aktivan", dugme.dataset.sekcija === navTab);
  });

  osveziAktivnuSekciju();
}

// Ponovo iscrtava sadržaj trenutno otvorene sekcije.
function osveziAktivnuSekciju() {
  const render = RENDERI[stanje.sekcija];
  if (render) render();
}

/* ===================================================================
 * KILAŽA + OBROCI + TRENING — preuzeto iz Fokusa (kilaza-trening.js).
 * Ispod ove linije je logika prebačena 1:1; samo je navigacija (nazad
 * dugmad, datum za nove treninge) prilagođena ovoj samostalnoj aplikaciji.
 * =================================================================== */

/* ===================== KALKULACIJE: OBROCI ===================== */

// Zbir svih obroka dana: kalorije, makroi i broj obroka. Stariji obroci
// nemaju upisane masti — "|| 0" ih tretira kao nulu umesto da zbir postane NaN.
function zbirObroka(datum) {
  const obroci = ucitajObroke(datum);
  const zbir = { kcal: 0, protein: 0, ugljeni: 0, masti: 0, broj: obroci.length };
  obroci.forEach((o) => {
    zbir.kcal += o.kcal || 0;
    zbir.protein += o.protein || 0;
    zbir.ugljeni += o.ugljeni || 0;
    zbir.masti += o.masti || 0;
  });
  return zbir;
}

// "obrok" / "obroka" — da zaglavlje sekcije zvuči prirodno.
const recObroka = (n) => (n === 1 ? "obrok" : "obroka");

/* ===================== TRENING ===================== */

// Trajanje treninga (od–do) u minutima.
const treningMinuta = (t) => vremeUMinute(t.do) - vremeUMinute(t.od);

// Mali prikaz tegova (5 stubića) popunjenih do date težine.
// klasa: "teg-mini" (red u listi) ili "teg-veliki" (detalj ekran).
function tegoviHtml(tezina, klasa) {
  const stubici = [1, 2, 3, 4, 5]
    .map((i) => `<span class="teg-bar${i <= tezina ? " puna" : ""}"></span>`).join("");
  return `<span class="${klasa}">${stubici}</span>`;
}

// Ekran "Treninzi": samo unos novog treninga za DANAS (naslov sa datumom +
// teg-birač). Pregled ranijih treninga je na Istoriji, po danu.
function renderTreninzi() {
  const oznaka = el("trening-danas-datum");
  if (oznaka) oznaka.textContent = imeDatuma(danasKey()).toUpperCase();
  crtajTegBirac();
}

// (Pre)crta 5 tegova u formi + reč težine. Poziva se pri renderu i pri tapu
// (u mestu — ne dira ostala polja forme koja korisnik popunjava).
function crtajTegBirac() {
  const birac = el("trening-tezina");
  if (!birac) return;
  const t = stanje.treningTezina;

  birac.innerHTML =
    [1, 2, 3, 4, 5].map((i) =>
      `<button type="button" class="teg-dugme${i <= t ? " puna" : ""}" data-teg="${i}"></button>`).join("") +
    `<span class="teg-oznaka">${TRENING_LABELE[t]} · ${t}/5</span>`;

  poveziKlik(birac, ".teg-dugme", (e) => {
    stanje.treningTezina = Number(e.currentTarget.dataset.teg);
    crtajTegBirac();
  });
}

// Otvara detaljni ekran jednog treninga. "izvor" je ekran na koji vodi dugme
// nazad (podrazumevano Detalj dana, odakle se treninzi i otvaraju).
function otvoriTrening(datum, id, izvor) {
  stanje.treningDatum = datum;
  stanje.treningId = id;
  stanje.treningNazad = izvor || "detalj";
  prikaziSekciju("trening");
}

// Detaljni ekran treninga: termin, težina (tegovi), šta sam radio, beleška.
function renderTrening() {
  const kontejner = el("trening-sadrzaj");
  const t = nadjiTrening(stanje.treningDatum, stanje.treningId);
  if (t === null) { // obrisan u međuvremenu
    prikaziSekciju(stanje.treningNazad);
    return;
  }
  const d = datumIzKljuca(stanje.treningDatum);
  const nazadOznaka = stanje.treningNazad === "detalj" ? "‹ Dan" : "‹ Treninzi";

  // Linije "šta sam radio": svaka se deli na "—" (levo naziv, desno detalj).
  const linijeHtml = (t.linije || "").split("\n").map((red) => {
    const tekst = red.trim();
    if (tekst === "") return "";
    const delovi = tekst.split("—");
    const levo = delovi[0].trim();
    const desno = delovi.length > 1 ? delovi.slice(1).join("—").trim() : "";
    return '<div class="trening-vezba">' +
        `<span class="trening-vezba-naziv">${escapeHtml(levo)}</span>` +
        (desno ? `<span class="trening-vezba-detalj">${escapeHtml(desno)}</span>` : "") +
      "</div>";
  }).join("");

  let html =
    '<header class="ekran-zaglavlje">' +
      "<div>" +
        `<button class="nazad-dugme" id="trening-nazad">${nazadOznaka}</button>` +
        `<p class="nadnaslov">TRENING · ${DANI[d.getDay()].toUpperCase()}</p>` +
        `<h1>${escapeHtml(t.naziv)}</h1>` +
      "</div>" +
      '<div class="zbir">' +
        `<strong>${formatTrajanje(treningMinuta(t))}</strong>` +
        `<small>${t.od}–${t.do}</small>` +
      "</div>" +
    "</header>" +

    '<p class="naslov-sekcije">TERMIN</p>' +
    '<div class="trening-termin">' +
      `<span class="trening-termin-vreme">${t.od}</span>` +
      '<span class="trening-termin-traka"></span>' +
      `<span class="trening-termin-vreme">${t.do}</span>` +
    "</div>" +

    '<p class="naslov-sekcije">TEŽINA SESIJE</p>' +
    '<div class="trening-tezina-kartica">' +
      tegoviHtml(t.tezina, "teg-veliki") +
      `<p class="trening-tezina-oznaka">${TRENING_LABELE[t.tezina]}` +
        ` <span>· ${t.tezina}/5</span></p>` +
    "</div>";

  if (linijeHtml) {
    html += `<p class="naslov-sekcije">ŠTA SAM RADIO</p><div class="lista">${linijeHtml}</div>`;
  }
  if (t.beleska && t.beleska.trim() !== "") {
    html += '<p class="naslov-sekcije">BELEŠKA</p>' +
      `<div class="trening-beleska">${escapeHtml(t.beleska)}</div>`;
  }

  html += '<button class="obrisi-trening" id="trening-obrisi">Obriši trening</button>';

  kontejner.innerHTML = html;
  el("trening-nazad").addEventListener("click", () => prikaziSekciju(stanje.treningNazad));
  el("trening-obrisi").addEventListener("click", () => {
    if (confirm(`Obrisati trening "${t.naziv}"?`)) {
      obrisiTrening(stanje.treningDatum, stanje.treningId);
      prikaziSekciju(stanje.treningNazad);
    }
  });
}

/* ===================== OBROCI (unos na Kilaži) ===================== */

// Kartica zbira: velike kalorije levo, makroi desno. Koristi je i Kilaža
// ("kcal danas") i Detalj dana ("kcal ukupno").
const zbirObrokaHtml = (zbir, oznakaKcal) =>
  '<div class="obrok-zbir">' +
    `<div class="obrok-zbir-glavno"><b>${formatKcal(zbir.kcal)}</b><small>${oznakaKcal}</small></div>` +
    '<div class="obrok-zbir-makroi">' +
      `<span><b>${formatGrami(zbir.protein)}</b><small>proteini</small></span>` +
      `<span><b>${formatGrami(zbir.ugljeni)}</b><small>ugljeni h.</small></span>` +
      `<span><b>${formatGrami(zbir.masti)}</b><small>masti</small></span>` +
    "</div>" +
  "</div>";

// Makroi jednog obroka (P / UH / M) — isti red se koristi na Kilaži i u Detalju.
const obrokMakroiHtml = (o) =>
  '<span class="obrok-makroi">' +
    `<b>${formatKcal(o.kcal)} kcal</b>` +
    `<span>P ${formatGrami(o.protein)}</span>` +
    `<span>UH ${formatGrami(o.ugljeni)}</span>` +
    `<span>M ${formatGrami(o.masti || 0)}</span>` +
  "</span>";

// Jedan red obroka: opis + makroi. Na Kilaži nosi i dugme za brisanje (uz
// data-id koji ga vezuje za obrok); u Detalju dana je istorija, pa samo prikaz.
const obrokRedHtml = (o, saBrisanjem) =>
  `<div class="obrok-red"${saBrisanjem ? ` data-id="${o.id}"` : ""}>` +
    '<span class="obrok-info">' +
      `<span class="obrok-opis">${escapeHtml(o.opis)}</span>` +
      obrokMakroiHtml(o) +
    "</span>" +
    (saBrisanjem ? '<button class="obrok-obrisi" title="Obriši obrok" aria-label="Obriši obrok">×</button>' : "") +
  "</div>";

// Lista obroka u zajedničkom omotaču (Kilaža i Detalj dana).
const obrociListaHtml = (obroci, saBrisanjem) =>
  '<div class="lista obroci-lista">' +
    obroci.map((o) => obrokRedHtml(o, saBrisanjem)).join("") +
  "</div>";

// Cela sekcija obroka na Kilaži: zbir dana, lista i forma za novi unos.
function renderObrociHtml() {
  const datum = danasKey();
  const obroci = ucitajObroke(datum);
  const zbir = zbirObroka(datum);
  const d = stanje.obrokDraft;

  let html = '<div class="obroci-blok">';

  html += `<p class="naslov-sekcije"><span class="obrok-naslov">${obrokIkonaSvg()}` +
    ` OBROCI · ${kratakDatum(datum).toUpperCase()}</span>` +
    `<span class="desno">${zbir.broj} ${recObroka(zbir.broj)}</span></p>`;

  // Zbir dana — prikazujemo ga i kad je nula, da unos ima jasan cilj.
  html += zbirObrokaHtml(zbir, "kcal danas");

  if (obroci.length) html += obrociListaHtml(obroci, true);

  html += '<div class="kartica-forma istaknuta obrok-forma">' +
    '<input class="obrok-opis-polje" type="text" maxlength="60" ' +
      `placeholder="Obrok — npr. Piletina sa pirinčem" value="${escapeHtml(d.opis)}">` +
    '<div class="red-polja obrok-brojevi">' +
      OBROK_POLJA.map(([labela, kljuc, klasa]) =>
        `<label>${labela} <input class="${klasa}" type="text" inputmode="numeric" ` +
        `placeholder="0" value="${escapeHtml(d[kljuc])}"></label>`).join("") +
    "</div>" +
    '<button class="obrok-dodaj glavno-dugme">+ Dodaj obrok</button>' +
  "</div>";

  return html + "</div>";
}

// Čita broj iz polja forme: prazno = 0, zarez radi kao decimalna tačka.
// Vraća null ako je uneto nešto što nije broj ili je negativno.
function brojIzPolja(tekst) {
  const t = String(tekst).trim().replace(",", ".");
  if (t === "") return 0;
  const v = parseFloat(t);
  return isNaN(v) || v < 0 ? null : v;
}

// Povezuje formu i listu obroka (poziva se iz renderKilaza posle innerHTML).
function poveziObroke(kontejner) {
  const d = stanje.obrokDraft;

  // Draft se pamti na svaki otkucaj da re-render (npr. stepper) ne obriše unos.
  const veze = [[".obrok-opis-polje", "opis"]]
    .concat(OBROK_POLJA.map(([, kljuc, klasa]) => ["." + klasa, kljuc]));
  veze.forEach(([selektor, kljuc]) => {
    const polje = kontejner.querySelector(selektor);
    if (polje) polje.addEventListener("input", (e) => { d[kljuc] = e.currentTarget.value; });
  });

  poveziKlik(kontejner, ".obrok-dodaj", () => {
    const opis = d.opis.trim();
    if (opis === "") {
      alert("Upiši šta si jeo.");
      return;
    }
    const kcal = brojIzPolja(d.kcal);
    const protein = brojIzPolja(d.protein);
    const ugljeni = brojIzPolja(d.ugljeni);
    const masti = brojIzPolja(d.masti);
    if (kcal === null || protein === null || ugljeni === null || masti === null) {
      alert("Kalorije, proteini, ugljeni hidrati i masti moraju biti brojevi (0 ili više).");
      return;
    }

    dodajObrok(danasKey(), {
      id: noviId(),
      opis: opis,
      kcal: kcal,
      protein: protein,
      ugljeni: ugljeni,
      masti: masti,
      upisan: Date.now()
    });

    stanje.obrokDraft = { opis: "", kcal: "", protein: "", ugljeni: "", masti: "" };
    renderKilaza();
  });

  poveziKlik(kontejner, ".obrok-obrisi", (e) => {
    obrisiObrok(danasKey(), e.currentTarget.closest(".obrok-red").dataset.id);
    renderKilaza();
  });
}

/* ===================== RENDER: KILAŽA ===================== */

// Prolazni tajmer za "Sačuvano ✓" poruku posle upisa kilaže.
let kilazaTajmer = null;

// Svi unosi kilaže kao niz [{datum, kg}], rastuće po datumu.
function kilazaNiz() {
  const k = ucitajKilazu();
  return Object.keys(k.unosi).sort().map((d) => ({ datum: d, kg: k.unosi[d] }));
}

// Unosi vidljivi u datom opsegu (7d / 30d / sve), po kalendarskom prozoru.
function kilazaVidljivi(opseg, svi) {
  if (opseg === "sve") return svi;
  const granica = pomeriDatum(danasKey(), -((opseg === "7d" ? 7 : 30) - 1));
  return svi.filter((u) => u.datum >= granica);
}

// Upisuje kilažu za dati dan (jedan unos po danu; ponovni upis je izmena).
function upisiKilazu(datum, kg) {
  const k = ucitajKilazu();
  k.unosi[datum] = kg;
  sacuvajKilazu(k);
}

// Postavlja (ili uklanja, kg = null) ciljnu kilažu. baza = trenutna težina u
// trenutku postavljanja (određuje smer: mršavljenje ili gojenje).
function postaviCiljKilaze(kg, baza) {
  const k = ucitajKilazu();
  k.cilj = kg;
  k.ciljBaza = kg === null ? null : baza;
  sacuvajKilazu(k);
}

// Zaokruži na 0,1 kg i ograniči na razuman opseg.
const clampKilaza = (v) => Math.round(Math.min(300, Math.max(30, v)) * 10) / 10;

// Dugme opsega grafika (7d/30d/sve) sa oznakom aktivnog.
const opsegDugme = (o) =>
  `<button data-opseg="${o}"${stanje.kilazaOpseg === o ? ' class="on"' : ""}>${o}</button>`;

/* ===================== DNEVNI CILJ KALORIJA ===================== */

// Podrazumevani dnevni maksimum kalorija dok korisnik ne postavi svoj.
const KCAL_MAX_PODRAZUMEVANO = 2000;

// Dnevni maksimum kalorija (čuva se uz kilažu, u ključu koji koristi samo
// ova aplikacija).
function kcalMax() {
  const v = ucitajKilazu().kcalMax;
  return typeof v === "number" && v > 0 ? v : KCAL_MAX_PODRAZUMEVANO;
}

// Menja dnevni maksimum kalorija (prompt; prazan unos vraća podrazumevani).
function klikKcalMax() {
  const odgovor = prompt("Dnevni maksimum kalorija (kcal):", String(kcalMax()));
  if (odgovor === null) return;
  const unos = odgovor.trim();
  const k = ucitajKilazu();
  if (unos === "") {
    k.kcalMax = null;
  } else {
    const v = parseInt(unos.replace(/[^\d]/g, ""), 10);
    if (isNaN(v) || v < 500 || v > 10000) {
      alert("Unesi broj između 500 i 10000 kcal.");
      return;
    }
    k.kcalMax = v;
  }
  sacuvajKilazu(k);
  renderKilaza();
}

// Prsten kalorija: koliko je od dnevnog maksimuma pojedeno. Luk kreće od vrha,
// tačka na kraju luka "kuca". Preko maksimuma prsten se puni do kraja i crveni.
function kcalPrstenHtml(zbir) {
  const max = kcalMax();
  const uneto = zbir.kcal;
  const ostatak = max - uneto;
  const preko = ostatak < 0;
  const boja = preko ? "#d9705c" : "#7fd0af";

  const R = 54, OBIM = 2 * Math.PI * R;              // 339.3 — dužina punog kruga
  const udeo = Math.max(0, Math.min(1, uneto / max));
  const ugao = (udeo * 360 - 90) * Math.PI / 180;    // -90° = vrh kruga
  const tx = (65 + R * Math.cos(ugao)).toFixed(1);
  const ty = (65 + R * Math.sin(ugao)).toFixed(1);
  const offset = (OBIM * (1 - udeo)).toFixed(1);

  // Makro trake: koliko kalorija svaki makro nosi u odnosu na dnevni maksimum
  // (protein i ugljeni hidrati 4 kcal/g, masti 9 kcal/g).
  const makroi = [
    ["Proteini", zbir.protein, 4],
    ["Ugljeni h.", zbir.ugljeni, 4],
    ["Masti", zbir.masti, 9]
  ].map(([ime, g, kcalPoG]) =>
    '<div class="makro-red">' +
      `<div class="makro-vrh"><span>${ime}</span><span>${formatGrami(g)}</span></div>` +
      `<span class="makro-traka"><span style="width:${Math.min(100, (g * kcalPoG / max) * 100).toFixed(0)}%"></span></span>` +
    "</div>").join("");

  return '<div class="kcal-kartica">' +
    '<div class="kcal-prsten">' +
      '<svg viewBox="0 0 130 130">' +
        `<circle class="kcal-staza" cx="65" cy="65" r="${R}"></circle>` +
        `<circle class="kcal-luk kcal-sjaj" cx="65" cy="65" r="${R}" stroke="${boja}" ` +
          `stroke-dasharray="${OBIM.toFixed(1)}" stroke-dashoffset="${offset}"></circle>` +
        `<circle class="kcal-luk" cx="65" cy="65" r="${R}" stroke="${boja}" ` +
          `stroke-dasharray="${OBIM.toFixed(1)}" stroke-dashoffset="${offset}"></circle>` +
        `<circle cx="${tx}" cy="${ty}" r="4.5" fill="${boja}"></circle>` +
        `<circle class="kcal-kuca" cx="${tx}" cy="${ty}" r="4.5" stroke="${boja}"></circle>` +
      "</svg>" +
      '<div class="kcal-sredina">' +
        `<b>${formatKcal(Math.abs(ostatak))}</b>` +
        `<span>${preko ? "KCAL PREKO" : "KCAL PREOSTALO"}</span>` +
      "</div>" +
    "</div>" +
    '<div class="kcal-desno">' +
      '<div class="kcal-zaglavlje">' +
        '<p class="kcal-cap">KALORIJE DANAS</p>' +
        '<button class="kcal-max">max ›</button>' +
      "</div>" +
      `<p class="kcal-zbir">${formatKcal(uneto)} / ${formatKcal(max)} kcal</p>` +
      makroi +
    "</div>" +
  "</div>";
}

// Crta SVG grafik kilaže iz vidljivih unosa: površina + linija težine,
// tanka isprekidana linija 7-dnevnog proseka, ciljna linija i poslednja tačka.
function buildKilazaChart(vidljivi, cilj) {
  const W = 340, H = 172, L = 16, RG = 328, T = 18, B = 148;
  const n = vidljivi.length;
  const vr = vidljivi.map((u) => u.kg);

  const minV = Math.min(...vr);
  const maxV = Math.max(...vr);
  const dmin = (cilj !== null ? Math.min(minV, cilj) : minV) - 0.3;
  const dmax = (cilj !== null ? Math.max(maxV, cilj) : maxV) + 0.3;

  const x = (i) => L + (RG - L) * (n === 1 ? 0.5 : i / (n - 1));
  const y = (v) => B - (B - T) * ((v - dmin) / (dmax - dmin));
  const tacka = (v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`;

  // 7-dnevni klizni prosek (prozor po indeksu vidljivog niza).
  const prosek = vr.map((_, i) => {
    const w = vr.slice(Math.max(0, i - 6), i + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });

  const povrsina = `M ${x(0).toFixed(1)},${B} L ${vr.map(tacka).join(" L ")} L ${x(n - 1).toFixed(1)},${B} Z`;

  let svg = `<svg class="kilaza-grafik" viewBox="0 0 ${W} ${H}" role="img" aria-label="Grafik kilaže">`;
  for (let k = 0; k < 4; k++) {
    const yy = T + (B - T) * k / 3;
    const val = dmax - (dmax - dmin) * k / 3;
    svg += `<line class="kg-grid" x1="${L}" y1="${yy.toFixed(1)}" x2="${RG}" y2="${yy.toFixed(1)}"></line>`;
    svg += `<text class="kg-yl" x="0" y="${(yy + 3).toFixed(1)}">${formatKg(val)}</text>`;
  }
  svg += `<path d="${povrsina}" fill="#232f4b" fill-opacity="0.08"></path>`;
  svg += `<polyline class="kg-prosek" points="${prosek.map(tacka).join(" ")}"></polyline>`;
  if (cilj !== null) {
    const gy = y(cilj);
    svg += `<line class="kg-cilj" x1="${L}" y1="${gy.toFixed(1)}" x2="${RG - 44}" y2="${gy.toFixed(1)}"></line>`;
    svg += `<text class="kg-cilj-l" x="${RG}" y="${(gy + 3).toFixed(1)}" text-anchor="end">cilj ${formatKg(cilj)}</text>`;
  }
  svg += `<polyline class="kg-linija" points="${vr.map(tacka).join(" ")}"></polyline>`;
  svg += `<circle class="kg-tacka" cx="${x(n - 1).toFixed(1)}" cy="${y(vr[n - 1]).toFixed(1)}" r="4"></circle>`;

  const anchors = ["start", "middle", "end"];
  [0, Math.floor((n - 1) / 2), n - 1].forEach((idx, m) => {
    svg += `<text class="kg-xl" x="${x(idx).toFixed(1)}" y="167" text-anchor="${anchors[m]}">` +
      `${kratakDatum(vidljivi[idx].datum)}</text>`;
  });
  return svg + "</svg>";
}

// Izračunava deltu kilaže u vidljivom opsegu; null ako nema bar dva unosa.
function kilazaDelta(vidljivi, poslednja) {
  if (vidljivi.length < 2) return null;
  const d = poslednja - vidljivi[0].kg;
  return { pad: d <= 0, tekst: `${d <= 0 ? "▼ " : "▲ "}${formatKg(Math.abs(d))} kg za ${vidljivi.length} dana` };
}

// Vraća {postignuto, preostalo} u odnosu na ciljnu kilažu, ili null bez cilja.
function ciljStatus(kilaza, svi, poslednja) {
  if (kilaza.cilj === null) return null;
  // Bazna težina (kad je cilj postavljen) određuje smer. Za stare ciljeve
  // bez zabeležene baze, uzmi prvi unos kao razuman početak.
  let baza = kilaza.ciljBaza;
  if (baza === null || baza === undefined) baza = svi.length ? svi[0].kg : poslednja;
  const postignuto = kilaza.cilj < baza
    ? poslednja <= kilaza.cilj + 0.0001
    : poslednja >= kilaza.cilj - 0.0001;
  return { postignuto: postignuto, preostalo: Math.abs(poslednja - kilaza.cilj) };
}

// Ekran "Danas": trenutna i ciljana kilaža, prsten kalorija sa makroima,
// stepper za unos težine i obroci. Grafik kretanja je na Istoriji.
// Pun re-render ide samo za upis kilaže, cilj, kcal maksimum i obroke —
// stepper i kucanje idu kroz osveziKilazaUnos.
function renderKilaza() {
  const kontejner = el("kilaza-sadrzaj");
  const kilaza = ucitajKilazu();
  const svi = kilazaNiz();

  // Inicijalizuj stepper: današnji unos → poslednji → 70,0 kg.
  if (stanje.kilazaDraft === null) {
    if (kilaza.unosi[danasKey()] !== undefined) stanje.kilazaDraft = kilaza.unosi[danasKey()];
    else if (svi.length) stanje.kilazaDraft = svi[svi.length - 1].kg;
    else stanje.kilazaDraft = 70.0;
  }

  let vidljivi = kilazaVidljivi(stanje.kilazaOpseg, svi);
  if (vidljivi.length < 2 && svi.length >= 2) vidljivi = svi;
  const poslednja = svi.length ? svi[svi.length - 1].kg : stanje.kilazaDraft;
  const delta = kilazaDelta(vidljivi, poslednja);
  const cilj = ciljStatus(kilaza, svi, poslednja);

  // ---- Zaglavlje ----
  let html = '<header class="ekran-zaglavlje"><div>' +
    `<p class="nadnaslov">${imeDatuma(danasKey()).toUpperCase()}</p>` +
    "<h1>Danas</h1>" +
  "</div></header>";

  // ---- Dve kartice: trenutna težina i ciljana (tap menja cilj) ----
  html += '<div class="danas-kartice">' +
    '<div class="danas-kg tamna">' +
      '<p class="danas-cap">TRENUTNA</p>' +
      `<div class="danas-broj"><b>${formatKg(poslednja)}</b><em>kg</em></div>` +
      (delta
        ? `<p class="danas-delta ${delta.pad ? "dole" : "gore"}">${delta.tekst}</p>`
        : '<p class="danas-delta">—</p>') +
    "</div>" +
    '<button class="danas-kg danas-cilj" title="Promeni cilj">' +
      '<p class="danas-cap">CILJANA</p>' +
      `<div class="danas-broj"><b>${kilaza.cilj === null ? "—" : formatKg(kilaza.cilj)}</b><em>kg</em></div>` +
      '<p class="danas-preostalo">' +
        (cilj === null
          ? "postavi cilj"
          : (cilj.postignuto ? "cilj postignut" : `još ${formatKg(cilj.preostalo)} kg`)) +
      "</p>" +
    "</button>" +
  "</div>";

  // ---- Prsten kalorija + makroi ----
  html += kcalPrstenHtml(zbirObroka(danasKey()));

  // ---- Stepper: unos današnje kilaže ----
  html += '<div class="kilaza-step-wrap">' +
    `<p class="cap">DANAŠNJA KILAŽA · ${kratakDatum(danasKey()).toUpperCase()}</p>` +
    '<div class="kilaza-stepper">' +
      '<button class="kilaza-korak" data-korak="-1">−</button>' +
      '<span class="val"><input class="kilaza-vrednost" type="text" inputmode="decimal" ' +
        `value="${formatKg(stanje.kilazaDraft)}" aria-label="Kilaža u kg"><small>kg</small></span>` +
      '<button class="kilaza-korak" data-korak="1">+</button>' +
    "</div>" +
    `<button class="kilaza-sacuvaj"${stanje.kilazaSacuvano ? ' style="background:#3d8f6f"' : ""}>` +
      tekstDugmetaCuvanja(kilaza) +
    "</button>" +
  "</div>";

  // ---- Obroci: današnji unosi + forma ----
  html += renderObrociHtml();

  kontejner.innerHTML = html;

  // ---- Interakcije ----
  // Pun re-render samo za upis kilaže, cilj i kcal maksimum.
  // Stepper, kucanje i skrol diraju samo unos.
  poveziKlik(kontejner, ".kcal-max", klikKcalMax);
  poveziKlik(kontejner, ".kilaza-korak", (e) => {
    promeniKilazaDraft(stanje.kilazaDraft + Number(e.currentTarget.dataset.korak) * 0.1);
  });
  poveziKlik(kontejner, ".kilaza-sacuvaj", () => {
    stanje.kilazaDraft = clampKilaza(stanje.kilazaDraft);
    upisiKilazu(danasKey(), stanje.kilazaDraft);
    stanje.kilazaSacuvano = true;
    renderKilaza();
    clearTimeout(kilazaTajmer);
    kilazaTajmer = setTimeout(() => {
      stanje.kilazaSacuvano = false;
      // Istekla je samo poruka na dugmetu — nema potrebe ponovo crtati grafik.
      if (stanje.sekcija === "kilaza") osveziKilazaUnos();
    }, 1600);
  });

  // Polje kilaže: klik + kucanje, Enter/blur potvrđuje, skrol menja za 0,1 kg.
  const polje = kontejner.querySelector(".kilaza-vrednost");
  if (polje) {
    polje.addEventListener("focus", (e) => e.currentTarget.select());
    polje.addEventListener("input", (e) => {
      const v = parseFloat(e.currentTarget.value.replace(",", "."));
      if (!isNaN(v)) {
        stanje.kilazaDraft = v;   // bez zaokruživanja dok korisnik kuca
        stanje.kilazaSacuvano = false;
        osveziKilazaUnos();       // polje ne diramo — u njemu je kursor
      }
    });
    polje.addEventListener("change", () => promeniKilazaDraft(stanje.kilazaDraft));
    polje.addEventListener("keydown", (e) => {
      if (e.key === "Enter") e.currentTarget.blur();
    });
    polje.addEventListener("wheel", (e) => {
      e.preventDefault();
      promeniKilazaDraft(stanje.kilazaDraft + (e.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });
  }

  poveziKlik(kontejner, ".danas-cilj", klikKilazaCilj);
  poveziObroke(kontejner);
}

// Natpis na dugmetu za čuvanje: prolazna potvrda, pa "Ažuriraj"/"Sačuvaj".
const tekstDugmetaCuvanja = (kilaza) =>
  stanje.kilazaSacuvano
    ? "Sačuvano ✓"
    : (kilaza.unosi[danasKey()] !== undefined ? "Ažuriraj za danas" : "Sačuvaj za danas");

// Menja vrednost stepera (uz zaokruživanje) i osvežava samo unos.
function promeniKilazaDraft(v) {
  stanje.kilazaDraft = clampKilaza(v);
  stanje.kilazaSacuvano = false;
  osveziKilazaUnos(true);
}

// Ciljani re-render: osvežava samo polje sa kilažom, dugme za čuvanje i —
// dok nema nijednog sačuvanog unosa — veliki broj u zaglavlju. To su jedini
// delovi ekrana koji zavise od drafta; grafik, statistika i obroci (sa svojim
// draftom) ostaju netaknuti. azurirajPolje = false dok korisnik kuca u polju.
function osveziKilazaUnos(azurirajPolje) {
  const kontejner = el("kilaza-sadrzaj");
  if (!kontejner) return;
  const kilaza = ucitajKilazu();

  if (azurirajPolje) {
    const polje = kontejner.querySelector(".kilaza-vrednost");
    if (polje) polje.value = formatKg(stanje.kilazaDraft);
  }

  const dugme = kontejner.querySelector(".kilaza-sacuvaj");
  if (dugme) {
    dugme.textContent = tekstDugmetaCuvanja(kilaza);
    if (stanje.kilazaSacuvano) dugme.style.background = "#3d8f6f";
    else dugme.removeAttribute("style");
  }

  // Bez ijednog sačuvanog unosa kartica "TRENUTNA" prikazuje draft.
  if (Object.keys(kilaza.unosi).length === 0) {
    const trenutna = kontejner.querySelector(".danas-kg.tamna .danas-broj b");
    if (trenutna) trenutna.textContent = formatKg(stanje.kilazaDraft);
  }
}

// Postavljanje/menjanje ciljne kilaže (prompt; prazan unos uklanja cilj).
function klikKilazaCilj() {
  const k = ucitajKilazu();
  const odgovor = prompt("Ciljna kilaža (kg):", k.cilj !== null ? formatKg(k.cilj) : "");
  if (odgovor === null) return;
  const unos = odgovor.trim().replace(",", ".");
  if (unos === "") {
    postaviCiljKilaze(null);
    renderKilaza();
    return;
  }
  const v = parseFloat(unos);
  if (isNaN(v) || v < 30 || v > 300) {
    alert("Unesi broj između 30 i 300 kg.");
    return;
  }
  // Bazna težina = poslednji unos (ili trenutna vrednost stepera ako još nema unosa).
  const svi = kilazaNiz();
  postaviCiljKilaze(Math.round(v * 10) / 10, svi.length ? svi[svi.length - 1].kg : stanje.kilazaDraft);
  renderKilaza();
}

/* ===================== AKCIJE: TRENING ===================== */

// Dodaje trening u dan (naziv + termin + slobodne linije + težina + beleška).
function dodajTrening(datum, t) {
  const dan = ucitajDan(datum);
  if (!dan.treninzi) dan.treninzi = [];
  dan.treninzi.push({
    id: noviId(),
    naziv: t.naziv, od: t.od, do: t.do,
    linije: t.linije, tezina: t.tezina, beleska: t.beleska
  });
  sacuvajDan(datum, dan);
}

// Briše trening iz dana.
function obrisiTrening(datum, id) {
  const dan = ucitajDan(datum);
  dan.treninzi = (dan.treninzi || []).filter((x) => x.id !== id);
  sacuvajDan(datum, dan);
}

// Nalazi trening po id-u; vraća null ako ne postoji.
const nadjiTrening = (datum, id) =>
  (ucitajDan(datum).treninzi || []).find((t) => t.id === id) || null;

// Prolazni tajmer za potvrdu "Sačuvano ✓" na dugmetu forme za trening.
let treningPotvrdaTajmer = null;

// Polja forme za trening — čiste se zajedno posle uspešnog upisa.
const TRENING_POLJA = ["trening-naziv", "trening-od", "trening-do", "trening-linije", "trening-beleska"];

// Dodavanje treninga iz forme. Trening se uvek beleži za DANAŠNJI datum.
function dodajTreningKlik() {
  const naziv = el("trening-naziv").value.trim();
  const od = el("trening-od").value;
  const doVreme = el("trening-do").value;

  if (naziv === "") { alert("Upiši naziv treninga."); return; }
  if (od === "" || doVreme === "") { alert("Upiši termin (od i do)."); return; }
  if (vremeUMinute(doVreme) <= vremeUMinute(od)) {
    alert("Vreme kraja mora biti posle vremena početka.");
    return;
  }

  dodajTrening(danasKey(), {
    naziv: naziv,
    od: od,
    do: doVreme,
    linije: el("trening-linije").value,
    tezina: stanje.treningTezina,
    beleska: el("trening-beleska").value.trim()
  });

  TRENING_POLJA.forEach((id) => { el(id).value = ""; });
  stanje.treningTezina = 3;
  renderTreninzi();

  // Kratka potvrda na dugmetu (nema više liste ispod da to pokaže).
  const dugme = el("trening-dodaj");
  if (dugme) {
    dugme.textContent = "Sačuvano ✓ — vidi u Istoriji";
    dugme.style.background = "#3d8f6f";
    clearTimeout(treningPotvrdaTajmer);
    treningPotvrdaTajmer = setTimeout(() => {
      dugme.textContent = "Sačuvaj trening";
      dugme.style.removeProperty("background");
    }, 1800);
  }
}

/* ===================== ISTORIJA: POMOĆNE ===================== */

// Ima li dan bar jedan trening?
const danImaTrening = (datum) => (ucitajDan(datum).treninzi || []).length > 0;

// Ima li dan bilo kakav unos (trening ili obrok)? Određuje da li se dan
// oboji na kalendaru i da li se može otvoriti Detalj. Jedno čitanje dana.
function danImaPodatke(datum) {
  const dan = ucitajDan(datum);
  return (dan.treninzi || []).length > 0 || (dan.obroci || []).length > 0;
}

// Prolazi kroz sve dane meseca i zove fn sa datum-ključem i brojem dana.
function zaSvakiDanMeseca(godina, mesec, fn) {
  const brojDana = new Date(godina, mesec + 1, 0).getDate();
  for (let dan = 1; dan <= brojDana; dan++) fn(dateKey(new Date(godina, mesec, dan)), dan);
}

// Ukupan broj treninga u datom mesecu.
function treninziUMesecu(godina, mesec) {
  let broj = 0;
  zaSvakiDanMeseca(godina, mesec, (kljuc) => { broj += (ucitajDan(kljuc).treninzi || []).length; });
  return broj;
}

// Prosečan dnevni unos kalorija u mesecu (samo dani sa obrocima). null ako nema.
function prosekKcalMeseca(godina, mesec) {
  let zbir = 0, dana = 0;
  zaSvakiDanMeseca(godina, mesec, (kljuc) => {
    if (danImaObroke(kljuc)) {
      zbir += zbirObroka(kljuc).kcal;
      dana++;
    }
  });
  return dana === 0 ? null : Math.round(zbir / dana);
}

/* ===================== RENDER: ISTORIJA ===================== */

// Pregled meseca: sažetak (treninzi + prosek kcal), kalendar obojen po unosu
// i lista poslednjih dana. Tap na dan otvara Detalj dana.
function renderIstorija() {
  const danas = new Date();
  const prikaz = new Date(danas.getFullYear(), danas.getMonth() + stanje.mesecOffset, 1);
  const godina = prikaz.getFullYear();
  const mesec = prikaz.getMonth();

  el("istorija-mesec").textContent =
    MESECI[mesec].charAt(0).toUpperCase() + MESECI[mesec].slice(1) +
    (godina !== danas.getFullYear() ? " " + godina : "");

  el("istorija-treninzi").textContent = treninziUMesecu(godina, mesec);
  const pros = prosekKcalMeseca(godina, mesec);
  el("istorija-kcal").textContent = pros === null ? "—" : formatKcal(pros);

  // Nema budućih meseci (nema podataka unapred).
  const napred = el("mesec-napred");
  if (napred) napred.disabled = stanje.mesecOffset >= 0;

  renderIstorijaKilazu();
  renderKalendar(godina, mesec);
  renderPoslednjeDane();
}

// Kretanje kilaže na Istoriji: naslov sa prekidačem opsega, kartica sa
// grafikom (trenutna težina + delta iznad njega) i tri statističke kartice.
function renderIstorijaKilazu() {
  const kontejner = el("istorija-kilaza");
  if (!kontejner) return;
  const kilaza = ucitajKilazu();
  const svi = kilazaNiz();

  let vidljivi = kilazaVidljivi(stanje.kilazaOpseg, svi);
  if (vidljivi.length < 2 && svi.length >= 2) vidljivi = svi; // izbegni grafik sa jednom tačkom

  let html = '<p class="naslov-sekcije naslov-opseg"><span>KRETANJE KILAŽE</span>' +
    `<span class="kilaza-opseg">${opsegDugme("7d")}${opsegDugme("30d")}${opsegDugme("sve")}</span></p>`;

  if (svi.length === 0) {
    html += '<div class="kilaza-prazno"><strong>Još nema unosa kilaže</strong>' +
      "<p>Unesi svoju težinu na ekranu Danas da počneš da pratiš trend.</p></div>";
    kontejner.innerHTML = html;
    poveziOpseg(kontejner);
    return;
  }

  const poslednja = svi[svi.length - 1].kg;
  const delta = kilazaDelta(vidljivi, poslednja);

  html += '<div class="grafik-kartica">' +
    '<div class="grafik-vrh">' +
      `<span class="grafik-kg"><b>${formatKg(poslednja)}</b><em>kg danas</em></span>` +
      (delta ? `<span class="danas-delta ${delta.pad ? "dole" : "gore"}">${delta.tekst}</span>` : "") +
    "</div>" +
    (vidljivi.length >= 2
      ? buildKilazaChart(vidljivi, kilaza.cilj)
      : '<div class="kilaza-prazno"><strong>Samo jedan unos do sada</strong>' +
        "<p>Grafik se pojavljuje kad uneseš kilažu za bar dva dana.</p></div>") +
  "</div>";

  const prosek = vidljivi.reduce((a, u) => a + u.kg, 0) / vidljivi.length;
  html += '<div class="kilaza-stat-red">' +
    `<div class="kilaza-stat tamna"><b>${formatKg(poslednja)}<small> kg</small></b><small>trenutna</small></div>` +
    `<div class="kilaza-stat"><b>${formatKg(prosek)}</b><small>prosek ${stanje.kilazaOpseg}</small></div>` +
    `<div class="kilaza-stat"><b>${formatKg(Math.min(...svi.map((u) => u.kg)))}</b><small>najniža</small></div>` +
  "</div>";

  kontejner.innerHTML = html;
  poveziOpseg(kontejner);
}

// Prekidač opsega grafika — precrtava samo blok kretanja kilaže.
function poveziOpseg(kontejner) {
  poveziKlik(kontejner, ".kilaza-opseg button", (e) => {
    stanje.kilazaOpseg = e.currentTarget.dataset.opseg;
    renderIstorijaKilazu();
  });
}

// Mini kalendar meseca (Pon–Ned). Boja dana: pun = trening, polovina = samo
// obroci, isprekidan = bez unosa. Tap na dan sa unosom otvara Detalj.
function renderKalendar(godina, mesec) {
  const kontejner = el("istorija-kalendar");
  const danasKljuc = danasKey();

  // getDay() vraća 0 za nedelju; nama treba ponedeljak = kolona 0.
  const pomak = (new Date(godina, mesec, 1).getDay() + 6) % 7;

  let html = ["P", "U", "S", "Č", "P", "S", "N"]
    .map((slovo) => `<span class="kal-zaglavlje">${slovo}</span>`).join("");
  html += "<span></span>".repeat(pomak);

  zaSvakiDanMeseca(godina, mesec, (kljuc, dan) => {
    let klasa;
    if (kljuc > danasKljuc) klasa = "bez-plana";      // budućnost
    else if (danImaTrening(kljuc)) klasa = "ispunjen";
    else if (danImaObroke(kljuc)) klasa = "delimican";
    else klasa = "bez-plana";
    const klase = `kal-dan ${klasa}${kljuc === danasKljuc ? " danas" : ""}`;
    html += `<button class="${klase}" data-datum="${kljuc}">${dan}</button>`;
  });
  kontejner.innerHTML = html;

  poveziKlik(kontejner, ".kal-dan", (e) => {
    const datum = e.currentTarget.dataset.datum;
    if (danImaPodatke(datum)) otvoriDetalj(datum);
  });
}

// Lista poslednjih dana sa unosom (do 60 dana unazad, najnoviji prvo).
function renderPoslednjeDane() {
  const kontejner = el("istorija-dani");
  let html = "";
  let kljuc = danasKey();

  for (let i = 0; i < 60; i++) {
    const dan = ucitajDan(kljuc);
    const brTren = (dan.treninzi || []).length;

    if (brTren || (dan.obroci || []).length) {
      const d = datumIzKljuca(kljuc);
      const zbir = zbirObroka(kljuc);
      const meta = [];
      if (zbir.broj) meta.push(`${zbir.broj} ${recObroka(zbir.broj)}`);
      if (brTren) meta.push(`${brTren} ${brTren === 1 ? "trening" : "treninga"}`);

      html +=
        `<button class="dan-red" data-datum="${kljuc}">` +
          `<span class="dan-broj">${String(d.getDate()).padStart(2, "0")}` +
            `<small>${DANI_KRATKO[d.getDay()]}</small></span>` +
          '<span class="dan-info">' +
            `<strong>${zbir.broj ? formatKcal(zbir.kcal) + " kcal" : "bez obroka"}</strong>` +
            `<span class="dan-meta">${meta.length ? meta.join(" · ") : "—"}</span>` +
          "</span>" +
          (brTren ? `<span class="dan-vreme">${treningIkonaSvg()}</span>` : "") +
        "</button>";
    }
    kljuc = pomeriDatum(kljuc, -1);
  }

  kontejner.innerHTML = html === "" ? '<p class="prazno">Još nema unetih dana.</p>' : html;

  poveziKlik(kontejner, ".dan-red", (e) => otvoriDetalj(e.currentTarget.dataset.datum));
}

/* ===================== RENDER: DETALJ DANA ===================== */

// Otvara ekran sa detaljima jednog dana iz istorije.
function otvoriDetalj(datum) {
  stanje.detaljDatum = datum;
  prikaziSekciju("detalj");
}

// Jedan trening u listi dana (tap otvara puni detalj treninga).
const treningRedHtml = (datum, t) =>
  `<button type="button" class="trening-red" data-datum="${datum}" data-id="${t.id}">` +
    '<span class="trening-tacka"></span>' +
    '<span class="trening-red-info">' +
      `<span class="trening-red-naziv">${escapeHtml(t.naziv)}</span>` +
      `<span class="trening-red-vreme">${t.od}–${t.do} · ${formatTrajanje(treningMinuta(t))}</span>` +
    "</span>" +
    tegoviHtml(t.tezina, "teg-mini") +
    '<span class="trening-strelica">›</span>' +
  "</button>";

// Detalj dana: obroci tog dana (sa zbirom kalorija i makroa) + odrađeni treninzi.
function renderDetalj() {
  const datum = stanje.detaljDatum;
  const d = datumIzKljuca(datum);
  const dan = ucitajDan(datum);
  const obroci = dan.obroci || [];
  const treninzi = dan.treninzi || [];
  const zbir = zbirObroka(datum);

  el("detalj-dan").textContent = DANI[d.getDay()].toUpperCase();
  el("detalj-datum").textContent = `${d.getDate()}. ${MESECI[d.getMonth()]}`;
  el("detalj-ukupno").textContent = formatKcal(zbir.kcal);

  // ---- Obroci ----
  let html = `<p class="naslov-sekcije"><span class="obrok-naslov">${obrokIkonaSvg()}` +
    ` OBROCI</span><span class="desno">${zbir.broj} ${recObroka(zbir.broj)}</span></p>`;
  if (obroci.length) {
    html += zbirObrokaHtml(zbir, "kcal ukupno");
    html += obrociListaHtml(obroci, false);
  } else {
    html += '<p class="prazno">Nema unetih obroka za ovaj dan.</p>';
  }

  // ---- Treninzi ----
  html += `<p class="naslov-sekcije"><span class="trening-naslov">${treningIkonaSvg()}` +
    ` TRENINZI</span><span class="desno">${treninzi.length}</span></p>`;
  if (treninzi.length) {
    html += '<div class="lista">' + treninzi.map((t) => treningRedHtml(datum, t)).join("") + "</div>";
  } else {
    html += '<p class="prazno">Nema treninga za ovaj dan.</p>';
  }

  const kontejner = el("detalj-sadrzaj");
  kontejner.innerHTML = html;

  poveziKlik(kontejner, ".trening-red", (e) => {
    const { datum: d2, id } = e.currentTarget.dataset;
    otvoriTrening(d2, id, "detalj");
  });
}

/* ===================== INIT ===================== */

// Renderer po sekciji — koristi ga osveziAktivnuSekciju.
const RENDERI = {
  kilaza: renderKilaza,
  treninzi: renderTreninzi,
  trening: renderTrening,
  istorija: renderIstorija,
  detalj: renderDetalj
};

// Povezuje statične kontrole (nav, forma za trening) i pokreće prvi render.
function init() {
  // Donja navigacija.
  document.querySelectorAll(".nav-dugme").forEach((dugme) => {
    dugme.addEventListener("click", (e) => prikaziSekciju(e.currentTarget.dataset.sekcija));
  });

  // Trening: dodavanje iz forme.
  el("trening-dodaj").addEventListener("click", dodajTreningKlik);

  // Istorija: prebacivanje meseca (bez budućih meseci).
  el("mesec-nazad").addEventListener("click", () => {
    stanje.mesecOffset--;
    renderIstorija();
  });
  el("mesec-napred").addEventListener("click", () => {
    if (stanje.mesecOffset < 0) stanje.mesecOffset++;
    renderIstorija();
  });

  // Detalj dana: povratak na Istoriju.
  el("detalj-nazad").addEventListener("click", () => prikaziSekciju("istorija"));

  prikaziSekciju("kilaza");
}

// Pokretanje: prvo se podaci učitaju sa servera (Supabase) u memorijski keš,
// pa tek onda kreće aplikacija. Bez mreže: prikaži poruku umesto praznog ekrana.
function pokreniAplikaciju() {
  const ekran = el("ucitavanje");
  ucitajSveIzBaze().then(() => {
    if (ekran) ekran.hidden = true;
    init();
  }).catch((e) => {
    console.error("Ne mogu da učitam podatke sa servera:", e);
    if (ekran) {
      ekran.innerHTML =
        '<div class="ucit-poruka">' +
          "<strong>Nema veze sa serverom</strong>" +
          "<p>Proveri internet konekciju pa pokušaj ponovo.</p>" +
          '<button onclick="location.reload()">Pokušaj ponovo</button>' +
        "</div>";
    }
  });
}

document.addEventListener("DOMContentLoaded", pokreniAplikaciju);
