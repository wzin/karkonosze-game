# Baśnie Karkonoszy — spec serii mini gier

Data: 2026-10-04. Status: zaakceptowany do implementacji (katalog i 4 gry wybrane przez właściciela projektu).

## 1. Cel i odbiorca

Seria krótkich (1–3 min) gier o Karkonoszach, każda o jednej rzeczy, z której słynie jedno miejsce.
Odbiorca: rodziny z dziećmi 8–12 lat. Fakty prawdziwe, ton baśniowy, styl indie. Mechanika może być
prosta, grafika i dźwięk muszą być bogate: sprite'y generowane przez fal.ai, shadery (żar, mgła,
światło lampy, pogoda), dźwięki i muzyka generowane AI.

Trzy kanały z jednego kodu:

| Kanał | Co widać | Różnice |
|---|---|---|
| Strona www | Panorama + wszystkie gry | zapis postępu w localStorage, odznaki |
| Kiosk w muzeum (touchscreen) | to samo | `?kiosk=1`: bez przewijania, większe hit-boxy, powrót do panoramy po 60 s bezczynności, bez linków zewnętrznych |
| Gra terenowa (QR) | tylko jedna gra | `#gra=kowary` otwiera grę bez panoramy; ukończenie zapisuje „zdobyte w terenie” |

Kanały 2 i 3 to tylko flagi routingu. Ten spec dotyczy przede wszystkim kanału 1.

## 2. Panorama (hub)

Prawdziwy widok z Grodnej (Zamek Księcia Henryka, Staniszów) na południe: **Śnieżka po lewej,
Szrenica po prawej**. Warstwy parallaxu (niebo, grzbiet daleki, grzbiet środkowy z Chojnikiem i
Grodną, kotlina, łąka) reagują na ruch wskaźnika / przechył. Chmury dryfują, gwiazdy migoczą, nad
Śnieżką majaczy sylwetka Ducha Gór. Shader mgły w dolinie.

17 markerów z katalogu (poniżej). Marker z grą w produkcji jest aktywny i otwiera grę; pozostałe
pokazują kartę koncepcji (lore + mechanika) z napisem „wkrótce”. Ukończona gra dostaje odznakę
(gwiazdki) na markerze.

## 3. Katalog miejsc (17)

Grzbiet i zachód: Szklarska Poręba (Hutnik z Józefiny) · Izery/Chata Walońska (Znaki Walonów) ·
Jakuszyce (Bieg Piastów) · Chojnik (Zakład Kunegundy).
Pod Śnieżką: Śnieżka (Liczyrzepa i księżniczka Emma) · Karpacz (Laborant) · Karpacz Górny (Kościół
z Norwegii / Wang) · Łomniczka (Z Kotła do Bobru).
Kotlina: Staniszów/Grodna (Luneta Księcia Henryka, punkt startowy) · Jelenia Góra (Tkacze woali) ·
Cieplice (Gorące źródła) · Siedlęcin (Fresk Lancelota) · Mysłakowice (Tyrolczycy) · Łomnica/Wojanów/
Bukowiec (Dolina Pałaców i Ogrodów).
Wschód: Kowary (Sztolnia) · Wieściszowice (Kolorowe Jeziorka) · Kamienna Góra/Chełmsko (Len).

Treści kart (lore, mechanika) są w prototypie koncepcyjnym i przechodzą 1:1 do `src/content/pl.json`.

## 4. Cztery gry do produkcji

Wspólne zasady: jedno zdanie instrukcji na ekran, sterowanie jednym palcem (stuknij / przytrzymaj /
przeciągnij), 3 gwiazdki za rundę lub całość, „Czy wiesz, że” po każdej rundzie, Duch Gór może się
pojawić jako gość. Każda gra ma intro (1 ekran), 3–5 rund, podsumowanie z tytułem.

### 4.1 Hutnik z Józefiny — Szklarska Poręba
Scena: wnętrze huty, piec z żarem (shader heat-haze + bloom), piszczel, stół z narzędziami, półka
z 5 słoikami tlenków. 5 klientów (Hrabina Schaffgotsch, Walon, Laborant, Duch Gór, mistrz Pohl),
losowe 3 na partię. Zamówienie = kształt (puchar/butla/flakon/kula/wazon) + kolor (kobalt→błękit,
żelazo→zieleń, złoto→rubin, mangan→fiolet, uran→uranowa zieleń) + wielkość (małe/duże).
Cztery ruchy: **Rozgrzej** (wskazówka oscyluje: popiół/żar/ogień, stuknij w żarze) → **Dmuchaj**
(przytrzymaj, bańka rośnie do przerywanego konturu; >130% pęka, jedna powtórka z karą) →
**Zabarw** (słoik; cząsteczki pigmentu wsiąkają w bańkę) → **Uformuj** (wybór formy; bańka
wskakuje w formę z animacją squash). Wynik: naczynie na stole, reakcja klienta (3 warianty), gwiazdki
z sumy: żar (0–1) + dmuchanie (0–1) + kolor (0/1) + forma (0/1): ≥3.3 → 3, ≥2.1 → 2, inaczej 1.
Grafika: tło huty, 5 portretów, 5 kształtów jako białe sprite'y barwione tintem, słoiki, piszczel,
forma, żar jako sprite + shader. Dźwięk: huk pieca (pętla), syk dmuchania, pęknięcie, wsyp pigmentu,
stuk formy, fanfara, pomruk klienta.

### 4.2 Liczyrzepa i księżniczka Emma — Śnieżka
Gracz jest Duchem Gór. Pole rzepy na zboczu pod kaplicą św. Wawrzyńca. W każdej z 5 rund rzepy
wyskakują z ziemi grupami i chowają się po 0.8–2 s; po fali gracz wybiera liczbę z 4 kafelków.
Trudność rośnie: więcej rzep (4→14), krótszy czas, kamienie-wabiki, a pogoda (shader: mgła, deszcz,
śnieg, słońce) zasłania część pola. Emma w tle ucieka o jeden odcinek po każdej rundzie; na końcu
znika w dolinie i Duch Gór burczy „Nie nazywajcie mnie Liczyrzepą”. Gwiazdki: liczba trafnych rund
(5→3★, 3–4→2★, inaczej 1★). Grafika: zbocze + kaplica + obserwatorium w tle, rzepa (3 klatki:
w ziemi, wychyla się, cała), kamień, Emma (2 klatki biegu), Duch Gór (sylwetka, portret). Dźwięk:
wiatr (pętla), „pop” rzepy, kroki Emmy, grzmot, dzwonek poprawnej odpowiedzi.

### 4.3 Sztolnia — Kowary
Ciemny przekrój sztolni; widać tylko krąg światła lampy górniczej (shader oświetlenia: maska radialna
+ migotanie + lekki szum). Gracz przeciąga lampę po ekranie; żyły rudy (żelazo: rdzawe; uran: słaba
zielona poświata widoczna tylko w świetle) ujawniają się pod lampą; stuknięcie 3× w żyłę = wykucie
(cząsteczki, dźwięk kilofa). Licznik Geigera trzeszczy głośniej przy uranie. Kapiąca woda gasi lampę
na chwilę; nietoperz przelatuje i przestawia lampę. Olej w lampie ubywa (60 s na poziom); 3 poziomy
(sztolnie XII w. żelazo, XIX w., 1948 uran). Gwiazdki z liczby wykopanych żył. Grafika: 3 tła
przekroju, żyły (2 typy), lampa, kilof, krople, nietoperz, wagonik na końcu. Dźwięk: kapanie (pętla),
Geiger (3 poziomy), kilof, stęknięcie zawału, nietoperz, dzwon zmiany.

### 4.4 Laborant — Karpacz
Laborant idzie pod górę (auto-scroll w prawo, 3 plany parallaxu zbocza). Recepta na górze ekranu:
3–4 zioła w kolejności. Rośliny przesuwają się przy ścieżce; stuknięcie zrywa. Właściwa z recepty →
do koszyka; obca (muchomor, pokrzywa) → kara (czerwony błysk, Laborant kicha). Po zebraniu: moździerz
— przeciągaj kołem, by utrzeć (pierścień postępu), potem wlej do flakonu (fiolet, nawiązanie do
Hutnika). 3 recepty: na kaszel (podbiał, pierwiosnek, prawoślaz), na stłuczenia (arnika, dziewięćsił),
na żołądek (goryczka, piołun, mięta). Gwiazdki z czystości koszyka i czasu utarcia. Grafika: 3 plany
zbocza, 8 roślin, Laborant (2 klatki), moździerz, flakon, koszyk. Dźwięk: kroki po kamieniach,
zerwanie, kichnięcie, ucieranie (pętla), chlup, dzwonek.

## 5. Architektura

```
karkonosze-game/
  src/
    main.ts                 bootstrap Pixi Application, router (#gra=…, ?kiosk=1), ScenesManager
    core/                   Scene (lifecycle), SceneManager, Assets (manifest loader), Audio (Howler,
                            tabela momentów), Save (localStorage), I18n (pl.json), Kiosk (idle timer),
                            Input (pointer helpers), Fx (filters: heat, fog, light, weather)
    ui/                     Button, SpeechBubble, Stars, FactCard, RoundProgress, Rotate hint
    hub/                    PanoramaScene, markers, ConceptCard
    games/
      glass/  turnips/  mine/  herbs/      każda gra: Scene + rounds + content.ts (dane) + README
    content/pl.json         WSZYSTKIE teksty (kiedyś cs.json, de.json, en.json)
  public/assets/gfx/<kategoria>/*.webp + .json (atlas)   public/assets/audio/*.mp3
  tools/assets/            manifest.yaml, generate.py (fal), cutout.py, pack.py, audio.py, lock
  docs/superpowers/specs|plans
```

Stack: Vite + TypeScript + PixiJS 8 (WebGL2; filtry GLSL jako shadery), Howler.js (dźwięk),
Python 3.12 + `fal-client` (pipeline assetów, uruchamiany ręcznie, wyniki commitowane).
Przestrzeń projektowa 1920×1080, skalowanie „fit” z letterboxem; w portrecie podpowiedź obrotu.
Bez backendu. Build statyczny (`dist/`) działa offline po pierwszym załadowaniu (kiosk).

Granice modułów: gra zna tylko `Scene` API (`init/enter/update/exit`), `Assets.get`, `Audio.play(moment)`,
`I18n.t(key)`, `Save`. Hub zna listę gier przez rejestr `games/index.ts`. Żaden moduł gry nie
importuje innego modułu gry.

## 6. Pipeline assetów (fal.ai)

- `manifest.yaml`: id, kategoria, prompt, trasa, rozmiar, cutout (tak/nie), skala logiczna.
- Trasy: stills/tła `fal-ai/flux-pro/v1.1`; wycinanie `fal-ai/birefnet`; warianty zestawu z kotwicy
  `fal-ai/nano-banana-pro/edit`; upscaling `fal-ai/esrgan`; SFX `fal-ai/elevenlabs/sound-effects`
  (fallback `cassetteai/sound-effects-generator`); muzyka `fal-ai/stable-audio-25/text-to-audio`
  (fallback `cassetteai/music-generator`). Trasy sprawdzić sondą na jednym prompcie przed hurtem.
- Każda generacja → `raw/manifest.lock.json` (model, prompt, seed, URL, wybrany wariant).
- Styl (prefiks każdego promptu, tak sformułowany, by nie dał się zacytować jako tekst): wycinanka
  z papieru + miękka gwasz, baśniowe indie, przygaszona paleta gór o zmierzchu, brak tekstu, brak
  realnych twarzy. Bez wypalonych efektów (ogień, poświata) — to robią shadery.
- Pakowanie: siatka, max 4096 px/bok, `meta.scale` jako string, WebP. Klucz tekstury
  `<kategoria>/<id>` lub `<kategoria>/<id>/<klatka>`.
- Dźwięki: pojedyncze pliki mp3 (bez audio-sprite'a na tym etapie), normalizacja głośności w
  `audio.py`, sprawdzenie ciszy (re-roll gdy < −40 dBFS peak).
- Klucz: `FAL_KEY` ze środowiska albo linia `fal: <klucz>` w `~/.api_keys`.
- Budżet: 40 MB WebP + 10 MB audio na całość.

## 7. Zapis, błędy, kiosk

- `Save`: `{ games: { glass: {stars, playedAt, field: bool} … }, version }` w localStorage, try/catch,
  bez zapisu działa dalej.
- Brak WebGL → komunikat tekstowy po polsku z linkiem do opisu gier (HTML fallback).
- Nie załadował się asset → scena używa placeholdera z `Graphics` i loguje; gra nie blokuje się.
- Kiosk: po 60 s bez dotyku w grze → powrót do panoramy z zachowaniem zapisu; brak zewnętrznych linków.

## 8. Testy i weryfikacja

- Vitest: logika punktacji każdej gry (czyste funkcje w `rules.ts`), parser trasy, Save, I18n.
- Pipeline: `pack.py --check` (stale `meta.scale`, limit 4096), test „żaden prompt nie zawiera słów
  ognia poza negacją”, test ciszy dźwięków.
- Smoke w przeglądarce (Playwright, `tools/smoke/`): załaduj hub, kliknij marker Szklarskiej,
  przejdź grę Hutnika stukając jak gracz (pointer events), zrzut ekranu do gitignorowanego
  `docs/screenshots/`.

## 9. Poza zakresem tej iteracji

Tłumaczenia, pozostałe 13 gier, prawdziwa trasa QR w terenie, PWA/offline cache, hosting.
