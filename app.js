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
 * Redosled u fajlu: konstante → stanje → datumi/format → navigacija →
 * (kilaža + obroci + trening render/logika, preuzeto iz Fokusa) →
 * lista treninga → init.
 */

/* ===================== KONSTANTE ===================== */

var DANI = ["Nedelja", "Ponedeljak", "Utorak", "Sreda", "Četvrtak", "Petak", "Subota"];
var DANI_KRATKO = ["NED", "PON", "UTO", "SRE", "ČET", "PET", "SUB"];
var MESECI = ["januar", "februar", "mart", "april", "maj", "jun", "jul", "avgust", "septembar", "oktobar", "novembar", "decembar"];

/* ===================== STANJE UI ===================== */

var stanje = {
  sekcija: "kilaza",          // kilaza | treninzi | trening (detalj)
  kilazaOpseg: "30d",         // opseg grafika kilaže: 7d | 30d | sve
  kilazaDraft: null,          // vrednost u steperu (kg) pre čuvanja; null = tek otvoreno
  kilazaSacuvano: false,      // prolazno: "Sačuvano ✓" posle upisa
  treningTezina: 3,           // izabrana težina (1–5) u formi za novi trening
  treningDatum: null,         // datum treninga otvorenog na Trening (detalj) ekranu
  treningId: null,            // id treninga otvorenog na Trening (detalj) ekranu
  obrokDraft: { opis: "", kcal: "", protein: "", ugljeni: "", masti: "" }
};

/* ===================== DATUMI I FORMAT ===================== */

// "YYYY-MM-DD" iz Date, u LOKALNOJ zoni (ne toISOString jer radi u UTC).
function dateKey(d) {
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var dan = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + dan;
}

function danasKey() {
  return dateKey(new Date());
}

// Jedinstven id (vreme + slučajni deo) — dovoljno za jednokorisničku app.
function noviId() {
  return Date.now() + "-" + Math.random().toString(36).slice(2, 8);
}

function datumIzKljuca(kljuc) {
  var delovi = kljuc.split("-");
  return new Date(Number(delovi[0]), Number(delovi[1]) - 1, Number(delovi[2]));
}

// Pomera datum-ključ za dati broj dana (npr. -1 za juče).
function pomeriDatum(kljuc, brojDana) {
  var d = datumIzKljuca(kljuc);
  d.setDate(d.getDate() + brojDana);
  return dateKey(d);
}

// "2026-07-04" → "Subota, 4. jul"
function imeDatuma(kljuc) {
  var d = datumIzKljuca(kljuc);
  return DANI[d.getDay()] + ", " + d.getDate() + ". " + MESECI[d.getMonth()];
}

// Minuti → "3h 53m", "45m" ili "0m" (za zbirove vremena).
function formatTrajanje(minuti) {
  minuti = Math.round(minuti);
  var h = Math.floor(minuti / 60);
  var m = minuti % 60;
  if (h === 0) return m + "m";
  if (m === 0) return h + "h";
  return h + "h " + m + "m";
}

// "09:00" → broj minuta od ponoći (540).
function vremeUMinute(tekst) {
  var delovi = tekst.split(":");
  return Number(delovi[0]) * 60 + Number(delovi[1]);
}

// Sprečava ubacivanje HTML-a kroz nazive koje korisnik unosi.
function escapeHtml(tekst) {
  var div = document.createElement("div");
  div.textContent = tekst;
  return div.innerHTML;
}

/* ===================== NAVIGACIJA ===================== */

// Prikazuje jednu sekciju (ekran), krije ostale i osveži njen sadržaj.
function prikaziSekciju(naziv) {
  stanje.sekcija = naziv;

  var sekcije = document.querySelectorAll("main > section");
  for (var i = 0; i < sekcije.length; i++) {
    sekcije[i].hidden = sekcije[i].id !== "sekcija-" + naziv;
  }

  // Svaki ulazak na Kilažu kreće sa skupljenim/neizmenjenim steperom.
  if (naziv === "kilaza") {
    stanje.kilazaDraft = null;
    stanje.kilazaSacuvano = false;
  }

  // Bottom nav: "trening" (detalj) ostaje pod tabom "treninzi".
  var navTab = naziv === "trening" ? "treninzi" : naziv;
  var dugmad = document.querySelectorAll(".nav-dugme");
  for (var j = 0; j < dugmad.length; j++) {
    dugmad[j].classList.toggle("aktivan", dugmad[j].dataset.sekcija === navTab);
  }

  osveziAktivnuSekciju();
}

// Ponovo iscrtava sadržaj trenutno otvorene sekcije.
function osveziAktivnuSekciju() {
  if (stanje.sekcija === "kilaza") renderKilaza();
  if (stanje.sekcija === "treninzi") renderTreninzi();
  if (stanje.sekcija === "trening") renderTrening();
}

// Kači "click" handler na sve elemente koji odgovaraju selektoru unutar
// kontejnera (this = element). Objedinjuje obrazac iz render funkcija.
function poveziKlik(kontejner, selektor, handler) {
  var elementi = kontejner.querySelectorAll(selektor);
  for (var i = 0; i < elementi.length; i++) {
    elementi[i].addEventListener("click", handler);
  }
}

/* ===================================================================
 * KILAŽA + OBROCI + TRENING — preuzeto iz Fokusa (kilaza-trening.js).
 * Ispod ove linije je logika prebačena 1:1; samo je navigacija (nazad
 * dugmad, datum za nove treninge) prilagođena ovoj samostalnoj aplikaciji.
 * =================================================================== */

/* ===================== KONSTANTE (DEO 2) ===================== */

// Reč uz težinu trening-sesije (indeks = broj tegova 1–5).
var TRENING_LABELE = ["", "Lako", "Umereno", "Solidno", "Naporno", "Maksimalno"];

// Bronzana boja treninga (ista kao paleta[2]) — blok na traci i akcenti.
var TRENING_BOJA = "#b3833f";

/* ===================== KALKULACIJE: OBROCI ===================== */

// Zbir svih obroka dana: kalorije, makroi i broj obroka. Stariji obroci
// nemaju upisane masti — "|| 0" ih tretira kao nulu umesto da zbir postane NaN.
function zbirObroka(datum) {
  var obroci = ucitajObroke(datum);
  var zbir = { kcal: 0, protein: 0, ugljeni: 0, masti: 0, broj: obroci.length };
  for (var i = 0; i < obroci.length; i++) {
    zbir.kcal += obroci[i].kcal || 0;
    zbir.protein += obroci[i].protein || 0;
    zbir.ugljeni += obroci[i].ugljeni || 0;
    zbir.masti += obroci[i].masti || 0;
  }
  return zbir;
}

// "1.850 kcal" — hiljade sa tačkom da se veliki brojevi lakše čitaju.
function formatKcal(n) {
  return Math.round(n).toLocaleString("sr-RS");
}

// Grami: bez decimala ("42 g"), jer se unose kao celi brojevi.
function formatGrami(n) {
  return Math.round(n) + " g";
}

/* ===================== TRENING ===================== */

// Ikonica bučice (koristi se u naslovu, redu i bloku na traci).
function treningIkonaSvg() {
  return '<svg class="teg-ikona" viewBox="0 0 24 24"><path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12" ' +
    'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
}

// Trajanje treninga (od–do) u minutima.
function treningMinuta(t) {
  return vremeUMinute(t.do) - vremeUMinute(t.od);
}

// Mali prikaz tegova (5 stubića) popunjenih do date težine.
// klasa: "teg-mini" (red/traka) ili "teg-veliki" (detalj ekran).
function tegoviHtml(tezina, klasa) {
  var s = "";
  for (var i = 1; i <= 5; i++) {
    s += '<span class="teg-bar' + (i <= tezina ? " puna" : "") + '"></span>';
  }
  return '<span class="' + klasa + '">' + s + "</span>";
}

// Ekran "Treninzi": podrazumevani datum u formi, teg-birač i lista poslednjih
// unetih treninga (skenira ~120 dana unazad, najnoviji prvo). Tap otvara detalj.
function renderTreninzi() {
  var polje = document.getElementById("trening-datum");
  if (polje && !polje.value) polje.value = danasKey();
  crtajTegBirac();

  var kontejner = document.getElementById("trening-lista");
  var redovi = [];
  var kljuc = danasKey();
  for (var i = 0; i < 120; i++) {
    var treninzi = ucitajDan(kljuc).treninzi || [];
    for (var j = 0; j < treninzi.length; j++) {
      redovi.push({ datum: kljuc, t: treninzi[j] });
    }
    kljuc = pomeriDatum(kljuc, -1);
  }

  if (!redovi.length) {
    kontejner.innerHTML = '<p class="prazno">Još nema unetih treninga. Dodaj prvi iznad.</p>';
    return;
  }

  var html = "";
  for (var k = 0; k < redovi.length; k++) {
    var d = datumIzKljuca(redovi[k].datum);
    var t = redovi[k].t;
    html +=
      '<button type="button" class="trening-red" data-datum="' + redovi[k].datum + '" data-id="' + t.id + '">' +
        '<span class="trening-tacka"></span>' +
        '<span class="trening-red-info">' +
          '<span class="trening-red-naziv">' + escapeHtml(t.naziv) + "</span>" +
          '<span class="trening-red-vreme">' + DANI_KRATKO[d.getDay()] + " " + d.getDate() + ". " + MESECI[d.getMonth()] +
            " · " + t.od + "–" + t.do + " · " + formatTrajanje(treningMinuta(t)) + "</span>" +
        "</span>" +
        tegoviHtml(t.tezina, "teg-mini") +
        '<span class="trening-strelica">›</span>' +
      "</button>";
  }
  kontejner.innerHTML = html;

  poveziKlik(kontejner, ".trening-red", function () {
    otvoriTrening(this.dataset.datum, this.dataset.id);
  });
}

// (Pre)crta 5 tegova u formi + reč težine. Poziva se pri renderu i pri tapu
// (u mestu — ne dira ostala polja forme koja korisnik popunjava).
function crtajTegBirac() {
  var birac = document.getElementById("trening-tezina");
  if (!birac) return;
  var t = stanje.treningTezina;
  var html = "";
  for (var i = 1; i <= 5; i++) {
    html += '<button type="button" class="teg-dugme' + (i <= t ? " puna" : "") + '" data-teg="' + i + '"></button>';
  }
  html += '<span class="teg-oznaka">' + TRENING_LABELE[t] + " · " + t + "/5</span>";
  birac.innerHTML = html;

  poveziKlik(birac, ".teg-dugme", function () {
    stanje.treningTezina = Number(this.dataset.teg);
    crtajTegBirac();
  });
}

// Otvara detaljni ekran jednog treninga.
function otvoriTrening(datum, id) {
  stanje.treningDatum = datum;
  stanje.treningId = id;
  prikaziSekciju("trening");
}

// Detaljni ekran treninga: termin, težina (tegovi), šta sam radio, beleška.
function renderTrening() {
  var kontejner = document.getElementById("trening-sadrzaj");
  var t = nadjiTrening(stanje.treningDatum, stanje.treningId);
  if (t === null) { // obrisan u međuvremenu
    prikaziSekciju("treninzi");
    return;
  }
  var d = datumIzKljuca(stanje.treningDatum);

  // Linije "šta sam radio": svaka se deli na "—" (levo naziv, desno detalj).
  var linijeHtml = "";
  var redovi = (t.linije || "").split("\n");
  for (var i = 0; i < redovi.length; i++) {
    var red = redovi[i].trim();
    if (red === "") continue;
    var delovi = red.split("—");
    var levo = delovi[0].trim();
    var desno = delovi.length > 1 ? delovi.slice(1).join("—").trim() : "";
    linijeHtml +=
      '<div class="trening-vezba">' +
        '<span class="trening-vezba-naziv">' + escapeHtml(levo) + "</span>" +
        (desno ? '<span class="trening-vezba-detalj">' + escapeHtml(desno) + "</span>" : "") +
      "</div>";
  }

  var html =
    '<header class="ekran-zaglavlje">' +
      "<div>" +
        '<button class="nazad-dugme" id="trening-nazad">‹ Treninzi</button>' +
        '<p class="nadnaslov">TRENING · ' + DANI[d.getDay()].toUpperCase() + "</p>" +
        "<h1>" + escapeHtml(t.naziv) + "</h1>" +
      "</div>" +
      '<div class="zbir">' +
        "<strong>" + formatTrajanje(treningMinuta(t)) + "</strong>" +
        "<small>" + t.od + "–" + t.do + "</small>" +
      "</div>" +
    "</header>" +

    '<p class="naslov-sekcije">TERMIN</p>' +
    '<div class="trening-termin">' +
      '<span class="trening-termin-vreme">' + t.od + "</span>" +
      '<span class="trening-termin-traka"></span>' +
      '<span class="trening-termin-vreme">' + t.do + "</span>" +
    "</div>" +

    '<p class="naslov-sekcije">TEŽINA SESIJE</p>' +
    '<div class="trening-tezina-kartica">' +
      tegoviHtml(t.tezina, "teg-veliki") +
      '<p class="trening-tezina-oznaka">' + TRENING_LABELE[t.tezina] +
        ' <span>· ' + t.tezina + "/5</span></p>" +
    "</div>";

  if (linijeHtml) {
    html += '<p class="naslov-sekcije">ŠTA SAM RADIO</p><div class="lista">' + linijeHtml + "</div>";
  }
  if (t.beleska && t.beleska.trim() !== "") {
    html += '<p class="naslov-sekcije">BELEŠKA</p>' +
      '<div class="trening-beleska">' + escapeHtml(t.beleska) + "</div>";
  }

  html += '<button class="obrisi-trening" id="trening-obrisi">Obriši trening</button>';

  kontejner.innerHTML = html;
  document.getElementById("trening-nazad").addEventListener("click", function () {
    prikaziSekciju("treninzi");
  });
  document.getElementById("trening-obrisi").addEventListener("click", function () {
    if (confirm('Obrisati trening "' + t.naziv + '"?')) {
      obrisiTrening(stanje.treningDatum, stanje.treningId);
      prikaziSekciju("treninzi");
    }
  });
}

/* (U Fokusu je ovde stajao renderDetaljObroke — prikaz obroka u Detalju dana.
   Ovde ne postoji taj ekran, pa je izostavljen; obroci se vide na Kilaži.) */

/* ===================== OBROCI (unos na Kilaži) ===================== */

// Ikonica obroka (viljuška i nož) — koristi se uz naslove sekcija.
function obrokIkonaSvg() {
  return '<svg class="obrok-ikona" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 3v8a2 2 0 0 0 4 0V3M8 11v10M18 3c-1.7 1-2.5 3-2.5 5.5S16.3 13 18 13v8"/></svg>';
}

// Kartica zbira: velike kalorije levo, makroi desno. Koristi je i Kilaža
// ("kcal danas") i Detalj dana ("kcal ukupno").
function zbirObrokaHtml(zbir, oznakaKcal) {
  return '<div class="obrok-zbir">' +
    '<div class="obrok-zbir-glavno"><b>' + formatKcal(zbir.kcal) + "</b><small>" + oznakaKcal + "</small></div>" +
    '<div class="obrok-zbir-makroi">' +
      "<span><b>" + formatGrami(zbir.protein) + "</b><small>proteini</small></span>" +
      "<span><b>" + formatGrami(zbir.ugljeni) + "</b><small>ugljeni h.</small></span>" +
      "<span><b>" + formatGrami(zbir.masti) + "</b><small>masti</small></span>" +
    "</div>" +
  "</div>";
}

// Makroi jednog obroka (P / UH / M) — isti red se koristi na Kilaži i u Detalju.
function obrokMakroiHtml(o) {
  return '<span class="obrok-makroi">' +
    "<b>" + formatKcal(o.kcal) + " kcal</b>" +
    "<span>P " + formatGrami(o.protein) + "</span>" +
    "<span>UH " + formatGrami(o.ugljeni) + "</span>" +
    "<span>M " + formatGrami(o.masti || 0) + "</span>" +
  "</span>";
}

// Jedan red obroka u listi (opis + makroi + dugme za brisanje).
function obrokRedHtml(o) {
  return '<div class="obrok-red" data-id="' + o.id + '">' +
    '<span class="obrok-info">' +
      '<span class="obrok-opis">' + escapeHtml(o.opis) + "</span>" +
      obrokMakroiHtml(o) +
    "</span>" +
    '<button class="obrok-obrisi" title="Obriši obrok" aria-label="Obriši obrok">×</button>' +
  "</div>";
}

// Cela sekcija obroka na Kilaži: zbir dana, lista i forma za novi unos.
function renderObrociHtml() {
  var datum = danasKey();
  var obroci = ucitajObroke(datum);
  var zbir = zbirObroka(datum);
  var d = stanje.obrokDraft;

  var html = '<div class="obroci-blok">';

  html += '<p class="naslov-sekcije"><span class="obrok-naslov">' + obrokIkonaSvg() +
    " OBROCI · " + kratakDatum(datum).toUpperCase() + "</span>" +
    '<span class="desno">' + zbir.broj + " " + recObroka(zbir.broj) + "</span></p>";

  // Zbir dana — prikazujemo ga i kad je nula, da unos ima jasan cilj.
  html += zbirObrokaHtml(zbir, "kcal danas");

  if (obroci.length) {
    html += '<div class="lista obroci-lista">';
    for (var i = 0; i < obroci.length; i++) html += obrokRedHtml(obroci[i]);
    html += "</div>";
  }

  html += '<div class="kartica-forma istaknuta obrok-forma">' +
    '<input class="obrok-opis-polje" type="text" maxlength="60" ' +
      'placeholder="Obrok — npr. Piletina sa pirinčem" value="' + escapeHtml(d.opis) + '">' +
    '<div class="red-polja obrok-brojevi">' +
      '<label>kcal <input class="obrok-kcal" type="text" inputmode="numeric" placeholder="0" value="' + escapeHtml(d.kcal) + '"></label>' +
      '<label>P (g) <input class="obrok-protein" type="text" inputmode="numeric" placeholder="0" value="' + escapeHtml(d.protein) + '"></label>' +
      '<label>UH (g) <input class="obrok-ugljeni" type="text" inputmode="numeric" placeholder="0" value="' + escapeHtml(d.ugljeni) + '"></label>' +
      '<label>M (g) <input class="obrok-masti" type="text" inputmode="numeric" placeholder="0" value="' + escapeHtml(d.masti) + '"></label>' +
    "</div>" +
    '<button class="obrok-dodaj glavno-dugme">+ Dodaj obrok</button>' +
  "</div>";

  return html + "</div>";
}

// "obrok" / "obroka" — da zaglavlje sekcije zvuči prirodno.
function recObroka(n) {
  return n === 1 ? "obrok" : "obroka";
}

// Čita broj iz polja forme: prazno = 0, zarez radi kao decimalna tačka.
// Vraća null ako je uneto nešto što nije broj ili je negativno.
function brojIzPolja(tekst) {
  var t = String(tekst).trim().replace(",", ".");
  if (t === "") return 0;
  var v = parseFloat(t);
  if (isNaN(v) || v < 0) return null;
  return v;
}

// Povezuje formu i listu obroka (poziva se iz renderKilaza posle innerHTML).
function poveziObroke(kontejner) {
  var d = stanje.obrokDraft;

  // Draft se pamti na svaki otkucaj da re-render (npr. stepper) ne obriše unos.
  var polja = [
    [".obrok-opis-polje", "opis"],
    [".obrok-kcal", "kcal"],
    [".obrok-protein", "protein"],
    [".obrok-ugljeni", "ugljeni"],
    [".obrok-masti", "masti"]
  ];
  polja.forEach(function (par) {
    var el = kontejner.querySelector(par[0]);
    if (el) el.addEventListener("input", function () { d[par[1]] = this.value; });
  });

  poveziKlik(kontejner, ".obrok-dodaj", function () {
    var opis = d.opis.trim();
    if (opis === "") {
      alert("Upiši šta si jeo.");
      return;
    }
    var kcal = brojIzPolja(d.kcal);
    var protein = brojIzPolja(d.protein);
    var ugljeni = brojIzPolja(d.ugljeni);
    var masti = brojIzPolja(d.masti);
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

  poveziKlik(kontejner, ".obrok-obrisi", function () {
    var red = this.closest(".obrok-red");
    obrisiObrok(danasKey(), red.dataset.id);
    renderKilaza();
  });
}

/* ===================== RENDER: KILAŽA ===================== */

// Prolazni tajmer za "Sačuvano ✓" poruku posle upisa kilaže.
var kilazaTajmer = null;

// Kilaža → "72,4" (srpski decimalni zapis).
function formatKg(v) {
  return v.toFixed(1).replace(".", ",");
}

// "2026-07-04" → "4. jul" (za oznake na grafiku i naslov stepera).
function kratakDatum(kljuc) {
  var d = datumIzKljuca(kljuc);
  return d.getDate() + ". " + MESECI[d.getMonth()];
}

// Svi unosi kilaže kao niz [{datum, kg}], rastuće po datumu.
function kilazaNiz() {
  var k = ucitajKilazu();
  return Object.keys(k.unosi).sort().map(function (d) {
    return { datum: d, kg: k.unosi[d] };
  });
}

// Unosi vidljivi u datom opsegu (7d / 30d / sve), po kalendarskom prozoru.
function kilazaVidljivi(opseg, svi) {
  if (opseg === "sve") return svi;
  var dana = opseg === "7d" ? 7 : 30;
  var granica = pomeriDatum(danasKey(), -(dana - 1));
  return svi.filter(function (u) { return u.datum >= granica; });
}

// Upisuje kilažu za dati dan (jedan unos po danu; ponovni upis je izmena).
function upisiKilazu(datum, kg) {
  var k = ucitajKilazu();
  k.unosi[datum] = kg;
  sacuvajKilazu(k);
}

// Postavlja (ili uklanja, kg = null) ciljnu kilažu. baza = trenutna težina u
// trenutku postavljanja (određuje smer: mršavljenje ili gojenje).
function postaviCiljKilaze(kg, baza) {
  var k = ucitajKilazu();
  k.cilj = kg;
  k.ciljBaza = kg === null ? null : baza;
  sacuvajKilazu(k);
}

// Zaokruži na 0,1 kg i ograniči na razuman opseg.
function clampKilaza(v) {
  return Math.round(Math.min(300, Math.max(30, v)) * 10) / 10;
}

// Dugme opsega grafika (7d/30d/sve) sa oznakom aktivnog.
function opsegDugme(o) {
  return '<button data-opseg="' + o + '"' + (stanje.kilazaOpseg === o ? ' class="on"' : "") +
    ">" + o + "</button>";
}

// Crta SVG grafik kilaže iz vidljivih unosa: površina + linija težine,
// tanka isprekidana linija 7-dnevnog proseka, ciljna linija i poslednja tačka.
function buildKilazaChart(vidljivi, cilj) {
  var W = 340, H = 172, L = 16, RG = 328, T = 18, B = 148;
  var n = vidljivi.length;
  var vr = vidljivi.map(function (u) { return u.kg; });

  var minV = Math.min.apply(null, vr);
  var maxV = Math.max.apply(null, vr);
  var dmin = (cilj !== null ? Math.min(minV, cilj) : minV) - 0.3;
  var dmax = (cilj !== null ? Math.max(maxV, cilj) : maxV) + 0.3;

  function x(i) { return L + (RG - L) * (n === 1 ? 0.5 : i / (n - 1)); }
  function y(v) { return B - (B - T) * ((v - dmin) / (dmax - dmin)); }

  // 7-dnevni klizni prosek (prozor po indeksu vidljivog niza).
  var prosek = vr.map(function (_, i) {
    var w = vr.slice(Math.max(0, i - 6), i + 1);
    return w.reduce(function (a, b) { return a + b; }, 0) / w.length;
  });

  var linija = vr.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ");
  var prosekLin = prosek.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" ");
  var povrsina = "M " + x(0).toFixed(1) + "," + B + " L " +
    vr.map(function (v, i) { return x(i).toFixed(1) + "," + y(v).toFixed(1); }).join(" L ") +
    " L " + x(n - 1).toFixed(1) + "," + B + " Z";

  var svg = '<svg class="kilaza-grafik" viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Grafik kilaže">';
  for (var k = 0; k < 4; k++) {
    var yy = T + (B - T) * k / 3;
    var val = dmax - (dmax - dmin) * k / 3;
    svg += '<line class="kg-grid" x1="' + L + '" y1="' + yy.toFixed(1) + '" x2="' + RG + '" y2="' + yy.toFixed(1) + '"></line>';
    svg += '<text class="kg-yl" x="0" y="' + (yy + 3).toFixed(1) + '">' + formatKg(val) + "</text>";
  }
  svg += '<path d="' + povrsina + '" fill="#232f4b" fill-opacity="0.08"></path>';
  svg += '<polyline class="kg-prosek" points="' + prosekLin + '"></polyline>';
  if (cilj !== null) {
    var gy = y(cilj);
    svg += '<line class="kg-cilj" x1="' + L + '" y1="' + gy.toFixed(1) + '" x2="' + (RG - 44) + '" y2="' + gy.toFixed(1) + '"></line>';
    svg += '<text class="kg-cilj-l" x="' + RG + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end">cilj ' + formatKg(cilj) + "</text>";
  }
  svg += '<polyline class="kg-linija" points="' + linija + '"></polyline>';
  svg += '<circle class="kg-tacka" cx="' + x(n - 1).toFixed(1) + '" cy="' + y(vr[n - 1]).toFixed(1) + '" r="4"></circle>';

  var idxs = [0, Math.floor((n - 1) / 2), n - 1];
  var anchors = ["start", "middle", "end"];
  for (var m = 0; m < 3; m++) {
    svg += '<text class="kg-xl" x="' + x(idxs[m]).toFixed(1) + '" y="167" text-anchor="' + anchors[m] + '">' +
      kratakDatum(vidljivi[idxs[m]].datum) + "</text>";
  }
  svg += "</svg>";
  return svg;
}

// Ceo Kilaža ekran: zaglavlje sa težinom i opsegom, cilj-traka, grafik,
// statistika i stepper za unos današnje kilaže. Prazna i "jedan unos" stanja
// su posebno obrađena.
function renderKilaza() {
  var kontejner = document.getElementById("kilaza-sadrzaj");
  var kilaza = ucitajKilazu();
  var cilj = kilaza.cilj;
  var svi = kilazaNiz();

  // Inicijalizuj stepper: današnji unos → poslednji → 70,0 kg.
  if (stanje.kilazaDraft === null) {
    if (kilaza.unosi[danasKey()] !== undefined) stanje.kilazaDraft = kilaza.unosi[danasKey()];
    else if (svi.length) stanje.kilazaDraft = svi[svi.length - 1].kg;
    else stanje.kilazaDraft = 70.0;
  }

  var vidljivi = kilazaVidljivi(stanje.kilazaOpseg, svi);
  if (vidljivi.length < 2 && svi.length >= 2) vidljivi = svi; // izbegni grafik sa jednom tačkom
  var poslednja = svi.length ? svi[svi.length - 1].kg : stanje.kilazaDraft;

  var html = "";

  // ---- Zaglavlje: težina + delta + prekidač opsega ----
  html += '<header class="ekran-zaglavlje kilaza-zaglavlje"><div>' +
    '<p class="nadnaslov">KILAŽA</p>' +
    '<div class="kilaza-veliko"><b>' + formatKg(poslednja) + "</b><em>kg</em></div>";
  if (vidljivi.length >= 2) {
    var delta = poslednja - vidljivi[0].kg;
    html += '<p class="kilaza-delta ' + (delta <= 0 ? "dole" : "gore") + '">' +
      (delta <= 0 ? "▼ " : "▲ ") + formatKg(Math.abs(delta)) + " kg za " + vidljivi.length + " dana</p>";
  }
  html += "</div>";
  if (svi.length >= 2) {
    html += '<div class="kilaza-opseg">' + opsegDugme("7d") + opsegDugme("30d") + opsegDugme("sve") + "</div>";
  }
  html += "</header>";

  // ---- Cilj: traka napretka ili poziv da se postavi ----
  if (svi.length >= 1) {
    if (cilj !== null) {
      // Bazna težina (kad je cilj postavljen) određuje smer. Za stare ciljeve
      // bez zabeležene baze, uzmi prvi unos kao razuman početak.
      var baza = kilaza.ciljBaza;
      if (baza === null || baza === undefined) baza = svi.length ? svi[0].kg : poslednja;

      var smerNanize = cilj < baza; // cilj ispod baze = mršavljenje, iznad = gojenje
      var postignuto = smerNanize ? (poslednja <= cilj + 0.0001) : (poslednja >= cilj - 0.0001);
      var preostalo = Math.abs(poslednja - cilj);
      var pct = cilj === baza
        ? (postignuto ? 100 : 0)
        : Math.max(0, Math.min(100, ((poslednja - baza) / (cilj - baza)) * 100));

      html += '<button class="kilaza-cilj-red" title="Promeni cilj">' +
        '<span class="kilaza-cilj-oznaka">CILJ ' + formatKg(cilj) + " kg</span>" +
        '<span class="kilaza-cilj-traka"><span style="width:' + pct.toFixed(0) + '%"></span></span>' +
        '<span class="kilaza-cilj-preostalo">' +
          (postignuto ? "cilj postignut" : "još " + formatKg(preostalo) + " kg") +
        "</span>" +
      "</button>";
    } else {
      html += '<button class="kilaza-cilj-postavi">+ Postavi cilj kilaže</button>';
    }
  }

  // ---- Grafik / prazna stanja ----
  if (vidljivi.length >= 2) {
    html += buildKilazaChart(vidljivi, cilj);
  } else if (svi.length === 0) {
    html += '<div class="kilaza-prazno"><strong>Još nema unosa kilaže</strong>' +
      "<p>Unesi svoju težinu ispod da počneš da pratiš trend kroz vreme.</p></div>";
  } else {
    html += '<div class="kilaza-prazno"><strong>Samo jedan unos do sada</strong>' +
      "<p>Grafik se pojavljuje kad uneseš kilažu za bar dva dana.</p></div>";
  }

  // ---- Statistika ----
  if (svi.length >= 1) {
    var sveKg = svi.map(function (u) { return u.kg; });
    var minSvi = Math.min.apply(null, sveKg);
    var prosek = vidljivi.reduce(function (a, u) { return a + u.kg; }, 0) / vidljivi.length;
    var prosekLabel = "prosek " + stanje.kilazaOpseg;
    html += '<div class="kilaza-stat-red">' +
      '<div class="kilaza-stat tamna"><b>' + formatKg(poslednja) + '<small> kg</small></b><small>trenutna</small></div>' +
      '<div class="kilaza-stat"><b>' + formatKg(prosek) + "</b><small>" + prosekLabel + "</small></div>" +
      '<div class="kilaza-stat"><b>' + formatKg(minSvi) + "</b><small>najniža</small></div>" +
    "</div>";
  }

  // ---- Stepper: unos današnje kilaže ----
  var danasImaUnos = kilaza.unosi[danasKey()] !== undefined;
  html += '<div class="kilaza-step-wrap">' +
    '<p class="cap">DANAŠNJA KILAŽA · ' + kratakDatum(danasKey()).toUpperCase() + "</p>" +
    '<div class="kilaza-stepper">' +
      '<button class="kilaza-korak" data-korak="-1">−</button>' +
      '<span class="val"><input class="kilaza-vrednost" type="text" inputmode="decimal" ' +
        'value="' + formatKg(stanje.kilazaDraft) + '" aria-label="Kilaža u kg"><small>kg</small></span>' +
      '<button class="kilaza-korak" data-korak="1">+</button>' +
    "</div>" +
    '<button class="kilaza-sacuvaj"' + (stanje.kilazaSacuvano ? ' style="background:#3d8f6f"' : "") + ">" +
      (stanje.kilazaSacuvano ? "Sačuvano ✓" : (danasImaUnos ? "Ažuriraj za danas" : "Sačuvaj za danas")) +
    "</button>" +
  "</div>";

  // ---- Obroci: današnji unosi + forma ----
  html += renderObrociHtml();

  kontejner.innerHTML = html;

  // ---- Interakcije ----
  poveziKlik(kontejner, ".kilaza-opseg button", function () {
    stanje.kilazaOpseg = this.dataset.opseg;
    renderKilaza();
  });
  poveziKlik(kontejner, ".kilaza-korak", function () {
    stanje.kilazaDraft = clampKilaza(stanje.kilazaDraft + Number(this.dataset.korak) * 0.1);
    stanje.kilazaSacuvano = false;
    renderKilaza();
  });
  poveziKlik(kontejner, ".kilaza-sacuvaj", function () {
    stanje.kilazaDraft = clampKilaza(stanje.kilazaDraft);
    upisiKilazu(danasKey(), stanje.kilazaDraft);
    stanje.kilazaSacuvano = true;
    renderKilaza();
    clearTimeout(kilazaTajmer);
    kilazaTajmer = setTimeout(function () {
      stanje.kilazaSacuvano = false;
      if (stanje.sekcija === "kilaza") renderKilaza();
    }, 1600);
  });

  // Polje kilaže: klik + kucanje, Enter/blur potvrđuje, skrol menja za 0,1 kg.
  var polje = kontejner.querySelector(".kilaza-vrednost");
  if (polje) {
    polje.addEventListener("focus", function () { this.select(); });
    polje.addEventListener("input", function () {
      var v = parseFloat(this.value.replace(",", "."));
      if (!isNaN(v)) {
        stanje.kilazaDraft = v;
        stanje.kilazaSacuvano = false;
        ponistiOznakuCuvanja(kontejner, danasImaUnos);
      }
    });
    polje.addEventListener("change", function () {
      stanje.kilazaDraft = clampKilaza(stanje.kilazaDraft);
      stanje.kilazaSacuvano = false;
      renderKilaza();
    });
    polje.addEventListener("keydown", function (e) {
      if (e.key === "Enter") this.blur();
    });
    polje.addEventListener("wheel", function (e) {
      e.preventDefault();
      stanje.kilazaDraft = clampKilaza(stanje.kilazaDraft + (e.deltaY < 0 ? 0.1 : -0.1));
      stanje.kilazaSacuvano = false;
      this.value = formatKg(stanje.kilazaDraft);
      ponistiOznakuCuvanja(kontejner, danasImaUnos);
    }, { passive: false });
  }

  var ciljEl = kontejner.querySelector(".kilaza-cilj-red, .kilaza-cilj-postavi");
  if (ciljEl) ciljEl.addEventListener("click", klikKilazaCilj);

  poveziObroke(kontejner);
}

// Ako je dugme još u stanju "Sačuvano ✓", vrati ga u normalno (kad se draft
// promeni skrolom/kucanjem bez punog re-rendera).
function ponistiOznakuCuvanja(kontejner, danasImaUnos) {
  var b = kontejner.querySelector(".kilaza-sacuvaj");
  if (b && b.textContent.indexOf("Sačuvano") !== -1) {
    b.textContent = danasImaUnos ? "Ažuriraj za danas" : "Sačuvaj za danas";
    b.removeAttribute("style");
  }
}

// Postavljanje/menjanje ciljne kilaže (prompt; prazan unos uklanja cilj).
function klikKilazaCilj() {
  var k = ucitajKilazu();
  var unos = prompt("Ciljna kilaža (kg):", k.cilj !== null ? formatKg(k.cilj) : "");
  if (unos === null) return;
  unos = unos.trim().replace(",", ".");
  if (unos === "") {
    postaviCiljKilaze(null);
    renderKilaza();
    return;
  }
  var v = parseFloat(unos);
  if (isNaN(v) || v < 30 || v > 300) {
    alert("Unesi broj između 30 i 300 kg.");
    return;
  }
  // Bazna težina = poslednji unos (ili trenutna vrednost stepera ako još nema unosa).
  var svi = kilazaNiz();
  var baza = svi.length ? svi[svi.length - 1].kg : stanje.kilazaDraft;
  postaviCiljKilaze(Math.round(v * 10) / 10, baza);
  renderKilaza();
}

/* ===================== AKCIJE: TRENING ===================== */

// Dodaje trening u dan (naziv + termin + slobodne linije + težina + beleška).
function dodajTrening(datum, t) {
  var dan = ucitajDan(datum);
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
  var dan = ucitajDan(datum);
  dan.treninzi = (dan.treninzi || []).filter(function (x) { return x.id !== id; });
  sacuvajDan(datum, dan);
}

// Nalazi trening po id-u; vraća null ako ne postoji.
function nadjiTrening(datum, id) {
  var lista = ucitajDan(datum).treninzi || [];
  for (var i = 0; i < lista.length; i++) {
    if (lista[i].id === id) return lista[i];
  }
  return null;
}

// Dodavanje treninga iz forme na Trening ekranu (datum se bira u formi).
function dodajTreningKlik() {
  var datum = document.getElementById("trening-datum").value || danasKey();
  var naziv = document.getElementById("trening-naziv").value.trim();
  var od = document.getElementById("trening-od").value;
  var doVreme = document.getElementById("trening-do").value;

  if (naziv === "") { alert("Upiši naziv treninga."); return; }
  if (od === "" || doVreme === "") { alert("Upiši termin (od i do)."); return; }
  if (vremeUMinute(doVreme) <= vremeUMinute(od)) {
    alert("Vreme kraja mora biti posle vremena početka.");
    return;
  }

  dodajTrening(datum, {
    naziv: naziv,
    od: od,
    do: doVreme,
    linije: document.getElementById("trening-linije").value,
    tezina: stanje.treningTezina,
    beleska: document.getElementById("trening-beleska").value.trim()
  });

  document.getElementById("trening-naziv").value = "";
  document.getElementById("trening-od").value = "";
  document.getElementById("trening-do").value = "";
  document.getElementById("trening-linije").value = "";
  document.getElementById("trening-beleska").value = "";
  stanje.treningTezina = 3;
  renderTreninzi();
}

/* ===================== INIT ===================== */

// Povezuje statične kontrole (nav, forma za trening) i pokreće prvi render.
function init() {
  // Donja navigacija.
  var navDugmad = document.querySelectorAll(".nav-dugme");
  for (var i = 0; i < navDugmad.length; i++) {
    navDugmad[i].addEventListener("click", function () {
      prikaziSekciju(this.dataset.sekcija);
    });
  }

  // Trening: dodavanje iz forme.
  document.getElementById("trening-dodaj").addEventListener("click", dodajTreningKlik);

  prikaziSekciju("kilaza");
}

// Pokretanje: prvo se podaci učitaju sa servera (Supabase) u memorijski keš,
// pa tek onda kreće aplikacija. Bez mreže: prikaži poruku umesto praznog ekrana.
function pokreniAplikaciju() {
  var ekran = document.getElementById("ucitavanje");
  ucitajSveIzBaze().then(function () {
    if (ekran) ekran.hidden = true;
    init();
  }).catch(function (e) {
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
