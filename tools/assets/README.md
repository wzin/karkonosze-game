# Pipeline grafiki (fal.ai)

Generuje obrazy z `manifest.yaml` przez fal.ai, wycina tła, pakuje do WebP w
`public/assets/gfx/<kategoria>/<id>.webp` i buduje `public/assets/gfx/manifest.json`
(`{ "assets": { "<kategoria>/<id>": { "src": "gfx/<kategoria>/<id>.webp", "w", "h" } } }`, ścieżki względem `/assets/`).
Uruchamiany ręcznie; wyniki (WebP, `manifest.json`, `raw/manifest.lock.json`) są commitowane, `raw/*.png` nie.

## Przygotowanie

```bash
cd tools/assets
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt
```

Klucz: `FAL_KEY` ze środowiska albo linia `fal: <klucz>` w `~/.api_keys` (`falkey.py`). Klucza nie wypisujemy i nie commitujemy.

## Komendy (z katalogu `tools/assets`)

```bash
.venv/bin/python -m pytest -q                       # testy (bez sieci): manifest, prompty, cutout, pack
.venv/bin/python generate.py                        # wszystko, co nie ma raw/<id>.png (4 wątki, tabela OK/FAIL)
.venv/bin/python generate.py --only hub/            # tylko id z prefiksem
.venv/bin/python generate.py --force hub/sky --force hub/valley --note "powód"   # re-roll tylko tych id
.venv/bin/python generate.py --choose hub/ridge_far=5 --note "dlaczego"         # wybór wcześniejszej próby
.venv/bin/python cutout.py [--only PREFIX] [--force ID ...]   # raw/<id>.cut.png dla cutout: true
.venv/bin/python pack.py                            # WebP + manifest.json (scalane z istniejącym), potem kontrola
.venv/bin/python pack.py --check                    # sama kontrola (działa bez raw/, np. w CI)
.venv/bin/python contact.py [--only P] [--cut | --packed]     # arkusze miniatur do przeglądu -> raw/_contact/
.venv/bin/python halo.py [--save]                   # obwódka pasów krajobrazu na ciemnym tle (#2a1f3d)
.venv/bin/python repair.py ID --shift-down PX --prompt "..."  # domalowanie obiektu uciętego górną krawędzią
```

Z katalogu głównego repo testy: `tools/assets/.venv/bin/python -m pytest tools/assets -q`.

## Manifest

Globalnie: `style` (zdanie stylu dla scen, z briefu), `style_object` (to samo bez „layered … scene”),
`cutout_suffix`, `band_suffix`, `wisp_suffix` (mgła na czarnym tle), `edit_suffix` (klatki postaci), `edit_suffix_scene` (tło przemalowane z tła-siostry). Asset: `id` (`<kategoria>/<nazwa>`, to też alias w grze),
`style` (`dusk|dark|morning` — pierwszy zestaw; `mist_dusk|mist_morning` — iteracja 1; `wisp` — smugi mgły), `size` (płótno generacji, wielokrotność 16, ≤ 2048), opcjonalnie
`out` (rozmiar wyjściowy, gdy inny niż `size`, może być > 2048, np. `hub/ridge_far` 2560), `cutout: true`, `kind` (`scene|object|band|wisp`),
`route` (`flux|ultra|nano|edit`), `ref` (dla `edit`), `prompt`, oraz opcje wycinania/pakowania:
`fade_x: true` (albo ułamek szerokości, domyślnie 0,25: alfa mnożona przez gładką rampę na lewym i prawym końcu, smugi mgły nie mają widocznych końców),
`peel_rim: light` (pas malarski bez papierowej krawędzi: bez zdzierania obwódki, erozja tylko pikseli w kolorze nieba, więc cienki ciemny maszt czy iglica zostają),
`key_pockets: false` (bez kluczowania zamkniętych „kieszeni” nieba: blada mgła między pniami nie zostaje wycięta w dziury).

Prompt = temat → ramka (`cutout_suffix` / `band_suffix`) → zdanie stylu:

| kind | domyślnie dla | ramka | styl | wycinanie |
|---|---|---|---|---|
| `scene` | bez `cutout` | — | `style` | brak (tło 1920×1080) |
| `object` | `cutout: true` | `cutout_suffix` | `style_object` | `fal-ai/birefnet` + naprawa dziur |
| `band` | jawnie | `band_suffix` | `style` | lokalne kluczowanie płaskiego nieba (`cutout.py`) |
| `wisp` | jawnie | `wisp_suffix` | `style_object` | lokalne kluczowanie luminancji (jasna mgła na czarnym tle → miękka alfa) |

Trasy: `flux` (domyślna) → `fal-ai/flux-pro/v1.1` (`safety_tolerance: "5"`, `enable_safety_checker: false`);
`ultra` → `fal-ai/flux-pro/v1.1-ultra` (najbliższe `aspect_ratio`, ok. 4 MP; do porównań z nano przy dużych planach);
`nano` → `fal-ai/nano-banana-pro` (tekst→obraz, najbliższe `aspect_ratio`, 1K/2K);
`edit` → `fal-ai/nano-banana-pro/edit` z `image_urls: [upload(raw/<ref>.png)]`, awaryjnie `fal-ai/flux-pro/kontext`.

## Lock (`raw/manifest.lock.json`)

`{ id: { model, prompt, seed, url, size, gen_size|aspect_ratio, returned_size, route, generated_at, attempts: [...], cutout: {...}, repairs: [...] } }`.
`attempts` to wszystkie próby po kolei (z `note` = powód re-rolla); pola na wierzchu = wybrana próba: ostatnia,
albo ta z `chosen` (numer od 1, ustawiany przez `generate.py --choose ID=N`, z uzasadnieniem w `chosen_note`).
Każda próba zostaje też lokalnie jako `raw/<id>.a<N>.png` (nie w repo), więc wybór wcześniejszej nie wymaga sieci
(bez kopii `--choose` pobiera obraz z `url` próby). Próba z `repairs` jest odtwarzana z `url` ostatniej naprawy,
bo `repair.py` nadpisuje `raw/<id>.png` po zrobieniu kopii — surowy obraz zawsze odpowiada temu, co opisuje lock.
`cutout` opisuje wycięcie (model/metoda, statystyki dziur, `paper_crop`, `sky_drift`, `rim_mode`), `repairs` poprawki z `repair.py`;
przy nowej próbie `repairs` przechodzą do próby, którą naprawiały.

## Pakowanie

- scene: najpierw odcięcie jasnego marginesu „kartki” (`paper_margin`: jasny kolor narożników na wszystkich
  czterech bokach + 6 px), potem cover-fit do `out`/`size`, WebP q84 bez alfy.
- object: przycięcie do bbox alfy w rozdzielczości surowej, dopasowanie do pudełka `size` (bez powiększania ponad surowe piksele), margines 8 px, WebP q88. Klatki animacji (`route: edit` + `ref`) mają wspólny bbox i skalę, więc się nie przesuwają.
- band: odcięcie wykluczowanych marginesów po bokach i u dołu (`band_margin`, gdy ląd nie sięga krawędzi),
  dopasowanie do szerokości, obcięcie nieba, ewentualne obcięcie dołu (zasłaniają go bliższe warstwy).
- wisp: jak object (przycięcie do bboxa alfy z kluczowania luminancji), potem `fade_x`.
- Scalanie: `pack.py` wczytuje istniejący `manifest.json`, przepakowuje tylko assety, których źródło jest w `raw/`
  (klatki animacji tylko gdy są wszystkie), pozostałe wpisy zostawia, usuwa wpisy id, których nie ma już w
  `manifest.yaml`, i wypisuje `repacked N, kept M`. `raw/` nie jest w repo, więc na czystym klonie `pack.py` nie
  psuje commitowanego manifestu (`repacked 0, kept 60`).
- `--check`: każdy wpis ma plik i zgodne wymiary, każdy id z `manifest.yaml` jest spakowany, bok ≤ 4096, suma ≤ 40 MB.

## Decyzje

**Rozmiary i model flux.** fal `flux-pro/v1.1` przycina każdy bok do 1440 i w dół do wielokrotności 32 *bez
zachowania proporcji* (sonda: 1920×1080 → 1440×1056, 2048×448 → 1440×448). Dlatego `generate.py` prosi o
rozmiar o tych samych proporcjach (≤ 1440, krok 32, ok. 1,4 MP, więc małe sprite'y też dostają detal), a
`pack.py` skaluje do celu. Test briefu wymaga wielokrotności 16, a 1080 nią nie jest: tła mają
`size: [1920, 1088], out: [1920, 1080]` (wyjście nadal 1920×1080, test bez zmian).

**Kolejność promptu.** Z zdaniem stylu na początku („Illustrated as a layered paper-cut storybook scene…”)
flux malował cały pejzaż i gubił temat: 7/7 assetów hubu w 1. próbie (niebo z górami i drzewami, chmury jako
krajobrazy, duch wśród drzew, grzbiet alpejski z zamkiem po prawej). Teraz: temat → ramka → styl.

**`style_object`.** Słowo „scene” w stylu nadal dorzucało tło do pojedynczych obiektów (kielich wśród liści,
kula na pagórkach, licznik Geigera przy drzewie). Obiekty dostają ten sam styl bez „layered … scene”.
W `style.dark` „warm lantern accents” → „warm ochre accents”: flux dorysowywał lampy w tłach kopalni, a światło
lampy robi shader.

**Pasy krajobrazu (`kind: band`, trasa `nano`).** birefnet zwraca pustą maskę dla krajobrazu (nie ma „obiektu”),
więc pasy (`hub/ridge_far`, `ridge_mid`, `valley`, `herbs/strip_mid`, `strip_near`) powstają nad płaskim jasnoszarym
niebem, które `cutout.py` usuwa kluczowaniem (tolerancja z szumu nieba, bo bladopastelowe świerki są tylko ~25 od
koloru nieba). flux w dwóch próbach rysował dla `ridge_far` alpejskie, postrzępione szczyty (raz z zamkiem
zamiast kaplicy, raz ze szczytem pośrodku), a dla `strip_near` widok w głąb z górami w tle, więc pasy przeszły na
`fal-ai/nano-banana-pro`, który trzyma kompozycję: łagodny, długi grzbiet z płaskowyżem i stożkiem Śnieżki
z kaplicą i „talerzami” obserwatorium w lewej trzeciej. nano daje maksymalnie 21:9, więc prompt prosi, by
ląd zajmował dolną część kadru.

**Obwódka pasów na ciemnym tle (poprawka po review).** Same kluczowanie zostawiało jasną krawędź: warstwy
„paper-cut” mają malowaną, prawie neutralną jasną krawędź papieru (do ~15 px w rozdzielczości surowej), a
odmieszanie od tła działało tylko na pikselach półprzezroczystych. Na #2a1f3d `hub/valley` miała ciągłą białą linię,
`ridge_mid` i `strip_mid` szare kontury. Teraz po kluczowaniu `cutout.py` (`peel_rim`): usuwa nieprzezroczyste piksele
do 16 px od nieba, bliskie kolorowi nieba (< 65) i mało nasycone (chroma < 20), chyba że tworzą duży, gruby obszar
(otwarcie 7 px i ≥ 3000 px, czyli prawdziwy jasny obiekt); wyrzuca małe wysepki unoszące się na niebie; kluczuje też
zamknięte „kieszenie” nieba między świerkami i źdźbłami (≥ 150 px); eroduje alfę o 3 px tylko od strony nieba
(4-sąsiedztwo, bez kwadratowych wyszczerbień); potem odmieszanie jak wcześniej. Pomiar `halo.py` (udział
nieprzezroczystych pikseli ≤ 8 px od nieba w odległości < 60 od koloru nieba; obok to samo 12–24 px w głąb jako
odniesienie): ridge_far 6,9 → 0,0 %, ridge_mid 30,2 → 0,9 %, valley 83,9 → 0,0 %, strip_mid 46,5 → 31,9 %
(wnętrze 34,7 %), strip_near 52,2 → 40,6 % (wnętrze 36,2 %). Pasy ziół są malowane bladą poranną paletą, więc
liczba nie spada do zera: krawędź ≈ wnętrze, czyli to kolor papieru, nie obwódka. Wierzchołki świerków i kaplica
z „talerzami” na Śnieżce zostały nietknięte (sprawdzone na złożeniu z ciemnym tłem).
Ograniczenie: blade, prawie neutralne detale na linii nieba mniejsze niż ok. 100×60 px w rozdzielczości surowej
(ok. 60×35 px po spakowaniu) tracą zewnętrzne 16 px albo znikają całkiem (np. iglica 50×8 px), bo wyglądają
jak krawędź papieru; pięć obecnych pasów sprawdzono wizualnie, a granicę przypinają testy w `test_cutout.py`.

**`hub/ridge_far`, naprawa.** W wybranej próbie dach kaplicy na Śnieżce był ucięty górną krawędzią.
`repair.py` przesunął obraz o 110 px w dół na tło nieba i `nano-banana-pro/edit` domalował stożkowy dach;
reszta obrazu bez widocznych zmian (zapis w `repairs` w locku).

**Naprawa dziur po birefnet.** Brief: >20 % otoczki wypukłej z alfą < 128 → wypełnić wnętrze konturu.
Na roślinach i postaciach (kształty wklęsłe) próg jest przekraczany zawsze (0,4–0,7), a dosłowne wypełnienie
zalewało prześwity między łodygami kremowym tłem (podbiał, prawoślaz, piołun, laborant). Teraz wypełniane są tylko
zamknięte dziury, które (a) wyraźnie różnią się kolorem od tła (> 60) i (b) mają *półprzezroczystą* alfę
(średnio ≥ 12) — to jest opisany błąd „zjedzonego ciemnego wnętrza”; dziurę, którą birefnet wyciął pewnie do zera
(np. pomarańczowa plama w pętli kabla Geigera), zostawiamy. Półprzezroczyste piksele krawędzi są „odmieszane” od
koloru tła; to nie usuwa malowanej jasnej krawędzi, dlatego pasy krajobrazu mają dodatkowo `peel_rim` (wyżej).
Cienie rzucane birefnet usuwa sam (rzepa, kamień, słoiki).

**Klatki animacji (`route: edit`).** `edit` nie dostaje zdania stylu, tylko `edit_suffix` („keep exactly the same
… colors …”): z dopisanym stylem porannym `herbs/laborant_2` w 1. próbie zmienił kolor płaszcza.

**Re-rolle (powód → wynik):**

- `hub/sky` 2×: góry i drzewa → sam gradient z księżycem; na dole zostały niskie wzgórza, ale w hubie zasłania je `ridge_far`.
- `hub/ridge_far` 3× (+naprawa), `hub/ridge_mid` 2×, `hub/valley` 2×: krajobraz zamiast warstwy / dalekie góry → pasy z nano.
- `hub/cloud_1` 2×: krajobraz → jedna chmura (biała zamiast lawendowej; da się ją `tint`ować). `hub/cloud_2` 2×: krajobraz → chmura.
- `hub/duch_gor` 3×: scena z górami, potem drzewa i spiczasty kapelusz czarodzieja → nano, sama postać.
- `glass/bg` 2×: ogień w piecu → ciemny, pusty otwór pieca.
- `glass/shape_puchar` 3×: maleńki kielich z jeleniem i kwiatami, potem liście papierowe przy podstawie → nano.
- `glass/shape_kula` 2×: kremowa, na pagórkach → biała kula. `glass/shape_wazon` 2×: krzewy wokół → sam wazon.
- `glass/mold` 3×: drzwiczki z butelkami w środku, potem fotorealistyczne klocki bez obręczy → nano: dwie połówki na zawiasach z żelaznymi okuciami.
- `turnips/bg` 2×: zamek zamiast kaplicy, brak bruzd → kaplica z kopułą w lewym górnym rogu, ścieżka, bruzdy w dolnej części.
- `mine/bg_1`, `bg_2` 2×: tunel w perspektywie z lampami na ścianach → przekrój boczny.
- `mine/bg_3` 5×: (2) niebo o zmierzchu z promieniem światła, (3) nano: płaski papierowy styl bez czytelnego
  tunelu, niespójny z `bg_1/2` (odrzucone w przeglądzie art), (4) flux: render 3D na czarnej ścianie z zapalonymi
  lampami → (5) `route: edit` z `ref: mine/bg_2` i `edit_suffix_scene`: ten sam malowany przekrój w skalnej ramie,
  betonowe łuki, stalowe dźwigary, kable wzdłuż ściany, rura wentylacyjna, tory, równe przyćmione światło bez lamp.
  Prompt: „Repaint this mine gallery as a later one: a 1950s uranium mine gallery seen in the same side cross-section
  through the rock. Replace the wooden timbering with concrete arches and steel beams, add thick electric cables and a
  large ventilation pipe running along the wall, and iron rails on the floor; remove the ladder, the barrels and the
  hanging lamp. The gallery is evenly and dimly lit by flat soft light with no lamps and no light sources, no people.”
- `mine/vein_iron` 3×: pomarańczowe pęknięcia jak lawa (2×) → nano, matowe rdzawe smugi.
- `mine/lamp` 2×: zapalona lampa w ramie z jaskini → lampa zgaszona. `mine/pickaxe` 2×: młotek/siekiera → kilof.
- `mine/geiger` 3×: radio z zegarem przy drzewie, potem pseudo-litery na tarczy → nano, czysta tarcza.
- `herbs/strip_mid` 2×, `strip_near` 3×: cienki pas w środku kadru / widok w głąb → pasy z nano.
- `herbs/plant_dziewieciesil` 3×: flux uparcie rysował wysoką łodygę („stemless” ignorowany) → nano, płaski kwiat na rozecie.
- `herbs/plant_podbial` 2×: krzak stokrotek mylący się z arniką → żółte koszyczki na czerwonawych łuskowatych łodygach.
- `herbs/plant_pierwiosnek` 2×: jaskier na łodydze → rozeta liści i zwisające dzwonkowate kwiaty.
- `herbs/mortar` 2×: moździerz z tłuczkiem wśród kwiatów → pusta misa.
- `herbs/pestle` 4×: flux 2× rysował moździerz z tłuczkiem; (3) nano: dobry kształt, ale pastelowe łaty z porannej
  palety (odrzucone w przeglądzie art) → (4) nano z jawnym kolorem: jednolity szary granit z ciemniejszymi plamkami,
  pionowo, wyraźnie tłuczek. Prompt: „A single apothecary pestle made of plain grey granite, on its own without a
  mortar bowl, standing upright: a short thick club with a wide rounded grinding end at the bottom and a narrower
  smooth handle at the top, side view. The whole pestle is one uniform neutral grey stone colour with a few darker grey
  speckles, like the grey stone mortar it belongs to; no other colours on it.”
- `herbs/laborant_2` 2×: zmiana koloru płaszcza → te same kolory, uniesiona laska.

**Słabsze, ale zostają (brak budżetu prób albo akceptowalne):** `mine/pickaxe` (kilof z jednym ostrzem i obuchem),
`mine/bg_2` (mała wisząca lampka pod stropem; przy ambient 0.06 prawie niewidoczna), `herbs/pestle` (na prawym dole
1-pikselowy jasnoniebieski ślad po papierowej chmurce z tła), `turnips/emma_2` (ręce zamienione, nogi prawie jak w klatce 1; kilka jasnych drobinek pod rąbkiem),
`hub/cloud_1` (biała), `turnips/mound` (raczej kretowisko z dziurą niż kopczyk). Styl: flux dał część obiektów jako wektorowy
clip-art (słoiki, portrety), nano wyraźniej trzyma „paper-cut + gwasz”; w obrębie zestawów (słoiki, portrety,
kształty szkła, rośliny) styl jest spójny.

### Iteracja 1 (2026-10-05, uwagi właściciela)

Plan: `docs/superpowers/plans/2026-10-05-iteration-1.md` („Kierunek artystyczny”, „Strumień B”). Przemalowane:
`hub/sky`, `hub/ridge_far`, `hub/ridge_mid`, `hub/valley`, `turnips/bg`, `herbs/bg_far`, `herbs/strip_mid`,
`herbs/strip_near`, `herbs/laborant_1`, `herbs/laborant_2`; nowe: `hub/mist_1`, `hub/mist_2`. Reszta zestawu bez zmian
(nadal style `dusk|dark|morning`).

**Styl `mist_dusk` / `mist_morning`.** Mniej dziecięco, poważniej i tajemniczo: „serious, atmospheric illustration for
a book of old mountain legends, not a cartoon and not childish”, gwasz z subtelną głębią warstw paper-cut, przygaszona
paleta (łupek, mech, śliwka, ochra), miękkie światło, mgła między planami. Bez „storybook” i „gentle rounded shapes”,
które ciągnęły w stronę dziecięcej ilustracji. Wszystkie nowe obrazy idą przez nano-banana-pro w 2K (tła 2752×1536,
pasy 3168×1344, pack zmniejsza), bo flux v1.1 daje najwyżej 1440 px, a w tym zadaniu liczy się wierność.
Pierwsze sformułowanie „matte gouache **on textured paper**” sprawiło, że nano 5 z 14 obrazów namalowało jako obraz na
kartce z białym marginesem (`ridge_far` #4, `valley` #3, `turnips/bg` #3, `strip_mid` #3, #4), także przy dopisanym
„no border”; teraz „with a fine paper grain”. Wybrane próby z pierwszej fali mają w locku dawne brzmienie stylu.
Margines z obrazów, które zostały, odcinają skrypty: `pack.paper_margin` (sceny), `cutout.paper_sides` i
`pack.band_margin` (pasy).

**Kluczowanie pasów.** (1) nano rozjaśnia „płaskie” niebo w mgiełkę ku linii horyzontu (`strip_near` #5: 220 → 232 na
800 px, poza tolerancją ~11), co zostawiało biały pas nad trawą; `key_sky` porównuje teraz niebo połączone z górną
krawędzią z kolorem *danego wiersza* (`sky_profile`: śledzi powolny dryf, dopóki wiersz jest w większości gładkim
niebem, potem zamrożony), kieszenie nadal z kolorem z góry. (2) Kieszenie nieba ≥ 150 px wycinały dziury w bladej mgle
między pniami (`strip_mid` #4) → `key_pockets: false`. (3) Pełne `peel_rim` erodowało 3 px od nieba i zjadało maszt
nadajnika na Śnieżnych Kotłach (6 px szerokości), iglicę kaplicy i obrys kopuł obserwatorium; bez niego krawędź miała
jasne kropki z ziarna papieru (alfa < 0,2 odmieszana wzmacnia szum) → `peel_rim: light` dla `ridge_far`. Pozostałe pasy
zostały przy pełnym `peel_rim` (sprawdzone na złożeniu; `halo.py`: brzeg ≤ wnętrze dla wszystkich pięciu).

**Smugi mgły (`kind: wisp`).** birefnet daje mgle twardą maskę, więc mgła jest malowana jasno na czarnym tle, a
`cutout.key_luma` liczy alfę z luminancji (tło = ciemna część brzegu, próg = szum tła × 1,5, góra = 99,5 percentyl),
kolor odmieszany od tła. Potem `fade_x: true` w `pack.py`: alfa × smoothstep od 0 na krawędzi do 1 na 25 % szerokości
z każdej strony (smugi wychodziły poza kadr, końce byłyby ucięte). Pierwsza próba (styl „dry-brush”) dała pociągnięcia
pędzla z włosiem zamiast mgły; druga ze stylem „soft, diffuse … like real fog or smoke, no visible brush strokes”.

**Wybór prób (`--choose`).** `generate.py` zapisuje każdą próbę jako `raw/<id>.a<N>.png`, a `--choose ID=N` przywraca
wcześniejszą (obraz + pola na wierzchu locka + `chosen`, `chosen_note`). Prompt w `manifest.yaml` dla wybranych
prób przywrócony do tematu tej próby; zdanie stylu jest już nowe (wyżej).

**Re-rolle iteracji 1 (powód → wynik):**

- `hub/sky` 1× (#3): dramatyczne niebo indygo → fiolet → śliwka, gęste niskie chmury, sierp księżyca, bez lądu na dole.
- `hub/ridge_far` 3× (#4–#6), wybrana #5: #4 nano dobre, ale dzienne światło i biały margin; #5 nano z dopiskiem o
  zmierzchu: cały grzbiet w kolejności — stożek Śnieżki z kaplicą i kopułami obserwatorium, urwisko kotła, płaskowyż z
  kotłami, kopuła, maszt na krawędzi kotłów, kolejne kotły, schronisko na Szrenicy po prawej, mgła u stóp; #6
  `flux-pro/v1.1-ultra`: ośnieżone Alpy pod błękitnym niebem, odrzucone. Pack 2560 px (z 3168 surowych, ostre).
- `hub/ridge_mid` 1× (#3): Chojnik na skale (prawo od środka), wieża Grodnej (lewo), mgła w kotlinach; nad nimi
  dalsze, blade wzgórza (nie góry; zasłaniają tylko stopę `ridge_far`).
- `hub/valley` 2× (#3 obraz na kartce z prostą górną krawędzią → #4): miasteczko z wieżą kościoła, słabe okna w ochrze,
  rzeka, mgła w dolinie, nieregularna linia koron drzew na górze.
- `hub/mist_1`, `hub/mist_2` 2×: pędzel z włosiem → miękka mgła/dym.
- `turnips/bg` 1× (#3): stożek z gołoborza (bez trawy), kaplica z kopułką i latarnią, dwa „spodki” obserwatorium,
  zygzakowata kamienna ścieżka, kosodrzewina, mgła, ciężkie chmury; bruzdy w dolnych ~34 % (rzędy kopczyków
  `FIELD` y 836–1028 leżą w nich). Margines kartki odcięty przez `paper_margin`.
- `herbs/bg_far` 1× (#2): chłodny mglisty poranek, plany świerków rozdzielone mgłą, szczyt z kaplicą w chmurze.
- `herbs/strip_mid` 3× (#3–#5), wybrana #4: wszystkie trzy jako obraz na kartce; #3 i #5 z niebem *wewnątrz* ramki
  (nie do wycięcia), #4 z niebem poza nią → `paper_sides` + `key_pockets: false`.
- `herbs/strip_near` 3× (#4–#6), wybrana #5: #4 kłęby mgły na niebie, #6 dwa pasy jeden nad drugim; #5: trawa i
  kamienie na górze, ubita ścieżka z płaskimi kamieniami: górna krawędź ścieżki = linia gruntu na ~59 % wysokości
  spakowanego pasa (y ≈ 228 z 388), pod nią gleba.
- `herbs/laborant_1` 1× (#2, nano): XVIII-wieczny laborant z profilu, idzie w prawo: trikorn, długi brązowy surdut,
  zielona kamizelka, halsztuk, spodnie do kolan, szare pończochy, trzewiki z klamrami, kosz z ziołami, laska.
- `herbs/laborant_2` 3× (#3–#5 edit), wybrana #5: #3 i #4 tylko szerszy krok, z przodu ta sama noga (guziki przy
  kolanie na tylnej nodze); #5 z opisem nóg w kadrze („noga z guzikami przy kolanie idzie do przodu”): nogi zamienione.

**Słabsze, ale zostają:** `hub/valley` (kilka jasnych plamek w koronach drzew na linii nieba, ~2 px po spakowaniu),
`hub/ridge_mid` (blade dalsze wzgórza z delikatnie jaśniejszą krawędzią), `herbs/strip_mid` (pojedyncze blade łaty mgły
między czubkami świerków; tło gry jest tam jasne), `hub/ridge_far` (kotły bardziej strome i skaliste niż w rzeczywistości;
grzbiet jaśniejszy od nieba — do przyciemnienia tintem w scenie). Styl: przemalowane warstwy są malarskie i półrealistyczne,
`ridge_mid` bardziej „wycinankowy”; na złożeniu hubu (niebo + trzy pasy + mgły na ciemnym tle 1920×1080) czyta się
to jako jeden mglisty krajobraz.
