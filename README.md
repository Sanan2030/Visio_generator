# VisioFlow

Azərbaycan dilində, formaya daxil edilən iş axınını canlı diaqrama çevirən veb alət. Seçilmiş iş masası yerləşməsində yumşaq qaranlıq forma solda, qaranlıq fondakı nöqtəli diaqram sahəsi sağda yerləşir. Next.js və React ilə hazırlanıb; Vercel-də yerləşdirilə bilər.

## İş ardıcıllığı

1. **İştirakçılar** formasında prosesin adını və təşkilatların (pool) sayını daxil et. Hər təşkilat kartında iştirakçı adını yazıb **İştirakçı əlavə et** düyməsinə bas və ya Enter sıx. Hər pool təşkilatı/tərəfi, daxilindəki lane-lər isə iştirakçı rollarını göstərir.
2. **Addımlar** bölməsində başlanğıcı yarat. **Yeni addım** formasında adı, element növünü və iştirakçını seçib **Addım əlavə et** düyməsinə bas və ya Enter sıx. Hər yaradılan kartı açaraq təsvir və keçidləri redaktə etmək olar; ardıcıl əlavəetmədə fokus ad sahəsində qalır.
3. Addım kartındakı yığcam keçid sətrinə və ya diaqramdakı kiçik etiketə basaraq hədəfi, qısa mətni və ətraflı izahı redaktə et. XOR bir yol, OR bir və ya bir neçə uyğun yol, AND isə bütün paralel yollar üçündür; qərar kartındakı üç düymə ilə növü dəyişmək olar. Bir addımdan bir neçə qol çıxanda onların nömrələri `4.1`, `4.2` kimi göstərilir.
4. Sağdakı diaqramda fiquru başqa iştirakçının lane-inə sürüklə. Buraxılacaq lane mavi vurğulanır və izah cədvəlində icraçı dəyişir. Oxlar ona bağlı qalır; yerləşmə hash ünvanındakı layihə ilə birlikdə saxlanılır və Visio ixracında qorunur. Fiqura iki dəfə kliklə və ya seçdikdən sonra görünən **Redaktə et** düyməsi ilə kompakt redaktə panelini aç. Seçilmiş fiqurun **+** tutacağını başqa fiqura apararaq keçid yarat; tutacağa və sonra hədəfə klikləmək də mümkündür.
5. **İzah** bölməsində üçsütunlu cədvələ bax və **Word cədvəli yüklə** ilə redaktə olunan `.docx` sənədini əldə et. Sütunlar **Addımın sıra N-si**, **İcraçı**, **Addımların təsviri** şəklindədir; qol nömrələri diaqramdakılarla eynidir. **Visio üçün yüklə** isə redaktə olunan `.vsdx` faylı yaradır.

Addım kartındakı yuxarı/aşağı düymələri forma sırasını dəyişir. **Bu addımdan sonra əlavə et** tək çıxışı olan addımın ardına yeni tapşırıq qoşur; mövcud keçidin şərti və izahı qorunur. Bir neçə qol varsa yeni tapşırıq yaradılır, hansı qola qoşulacağını keçid formasında seçirsən. **Axın ardıcıllığı üzrə nömrələ** başlanğıcdan BFS ilə yolları izləyir, dövrləri təkrar saymır, əlaqəsiz addım və qeydləri sonunda saxlayır. Forma, diaqram, Word və Visio eyni sıra və qol nömrələrindən istifadə edir; əl ilə yerləşdirilmiş fiqurların mövqeyi dəyişmir.

İki addım arasındakı oxu seçib **+** tutacağına basmaq həmin keçidin arasına tapşırıq əlavə edir. Palitradakı tapşırıq və ya qərarı oxun üstünə sürüşdürmək də mümkündür; uyğun ox vurğulananda burax. Əlaqəsiz addımı və təhlükəsiz tək giriş/tək çıxışlı addımı da başqa oxun arasına keçirmək olar. Əvvəlki şərt və tam izah qorunur, yeni keçid və nömrələr Word/Visio-da yenilənir. Qolları və ya fərqli izahları itirəcək birləşdirmə edilmir. Yeni fiqur başqa fiquru örtərsə, boş yerə yerləşdirilir.

Diaqramın, pool-un və seçilmiş fiqurun sağ aşağı küncündəki tutacağı çəkərək ölçüsünü dəyiş. Tutacaq fokusda olduqda ox düymələri 10, Shift + ox 50 piksel dəyişir; Escape sürüşdürməni ləğv edir. Yuxarıdakı **Diaqram ölçüləri** düyməsi en/hündürlüyü rəqəmlə daxil etməyə və avtomatik ölçüyə qayıtmağa imkan verir. Ölçülər layihə ilə saxlanılır, yenilənəndə bərpa olunur və VSDX/SVG/PNG-yə tətbiq edilir. İçəridəki fiqurları kəsəcək qədər kiçiltmək mümkün deyil.

Sol forma ilə diaqram arasındakı sərhədi çəkərək paneli 280–640 piksel aralığında dəyişmək olar; dar ekranda diaqram üçün yer saxlanılır. Sərhəd fokusda olduqda sol/sağ ox 20, Shift + ox 40 piksel dəyişir. İki klik standart 400 pikselə qaytarır. Bu görünüş seçimi brauzerdə saxlanılır; mobil ekranda forma diaqramın üstündə yerləşir.

**Nümunə proses** menyusunda “Müştəri müraciətləri” ilə yanaşı **Təsdiq prosesi**, **Sorğu-cavab** və **İşə qəbul** şablonları var. Hər açılış yeni layihə yaradır, əvvəlki saxlanmış iş öz hash ünvanında qalır. Layihə menyusundakı **SVG kimi yüklə** və **PNG kimi yüklə** bütün diaqramı şəkil kimi çıxarır. Azərbaycan hərfləri üçün yerli DM Sans/DM Mono şriftləri SVG-yə daxil edilir; redaktə tutacaqları və seçim vurğuları ixrac edilmir. PNG böyük diaqramlarda maksimum 16 milyon piksel və 8192 piksel tərəf həddində yaradılır. Ekrandakı qaranlıq tema yalnız redaktora aiddir; SVG/PNG faylları ağ fon və oxunaqlı açıq palitra ilə hazırlanır.

Addımın formasında və diaqram redaktə panelində **Əlavə məlumatlar** bölməsi var: **Müddət (SLA)**, **Sistem**, **Sənəd**. Bunlar istəyə bağlı mətn sahələridir; boş saxlananda köhnə layihənin davranışı dəyişmir. SLA üçün məsələn “2 iş günü” yazmaq olar; sahə prosesin vaxtını avtomatik ölçmür. Doldurulmuş məlumatlar izahda və VSDX fiqurunun Shape Data hissəsində görünür. **İzah** bölməsində seçdiyin məlumatlar Word və önbaxış cədvəlində ayrıca sütun olur; seçilməyən məlumatlar təsvirin içində qalır. Sütun seçimi cari açıq sessiyaya aiddir.

Struktur yoxlaması AND ilə ayrılıb XOR ilə birləşən və XOR ilə ayrılıb AND ilə birləşən qolları xəta kimi göstərir. Yoxlama eyni pool daxilindəki ilk ortaq birləşməyə əsaslanır; ayrı sonluqlar və qeyri-müəyyən dövrlər üçün cütlük təxmin etmir. Əvvəlki adi tapşırıqda birləşmiş yollar və pool-lar arasında mesaj keçidləri ayrıca split/join cütlüyü sayılmır.

Diaqramın aşağısındakı alət panelində **Seç**, **Sahəni sürüşdür**, başlanğıc, tapşırıq, qərar, keçid və qeyd düymələri var. Seçilmiş elementin üstündə ayrıca **Redaktə et**, **Surətini yarat** və **Sil** əməliyyatları görünür. Sahəni sürüşdür aləti seçiləndə fiqurun üzərindən sürükləmək də yalnız görünüşü hərəkət etdirir. **Keçid çək** seçilmiş addımı növbəti kliklənən fiqura bağlayır. Digər element növlərini forma və ya redaktə panelində seçmək olar.

Fokus fiqurda olduqda ox düymələri onu 1 vahid, Shift + ox isə 10 vahid hərəkət etdirir; F2 redaktə panelini açır, Delete fiquru silir. Sürüşdürmə zamanı Esc hərəkəti ləğv edir. Fokus diaqram sahəsində olduqda oxlar sahəni sürüşdürür. Aşağı sağdakı **Avtomatik düz** əl ilə yerləşdirməni sıfırlayır; **Geri al** əvvəlki vəziyyəti qaytarır, **Yenidən tətbiq et** isə geri alınmış dəyişikliyi bərpa edir. Böyütmə, ekrana sığdırma və tam ekran rejimində redaktə də mümkündür. Yuxarıdakı proses adına basmaq **Yeni diaqram**, **Nümunə proses**, kömək və silmə menyusunu açır; **Word izahı** birbaşa `.docx` cədvəlini yükləyir.

Oxun xəttinə basmaq onu seçir və hər iki ucunda dairə tutacağı göstərir. Başlanğıc və ya hədəf ucunu başqa fiqura sürüşdürərək yenidən bağla; tutacağa və sonra fiqura klikləmək də mümkündür. Kiçik etiketə basmaq izah panelini açır. Paneldə həm başlanğıc, həm hədəf addımı seçmək olar. Uyğun olmayan fiqura və ya boş sahəyə buraxmaq əvvəlki keçidi saxlayır; Esc dəyişdirməni ləğv edir. Keçidin qısa şərti və yazdığın ətraflı izahı qorunur, hədəf məlumatı və qol nömrələri isə avtomatik yenilənir.

**Surətini yarat** seçilmiş fiqurun adını, təsvirini, növünü və icraçısını köçürür, keçidlərini boş saxlayır; yeni surəti sonra axına bağlamaq olar. Diaqram fokusda olduqda **Ctrl/Cmd+Z** geri alır, **Ctrl/Cmd+Shift+Z** və **Ctrl+Y** yenidən tətbiq edir, **Ctrl/Cmd+D** fiqurun surətini yaradır. Mətn sahələrində bu düymələr həmin sahənin adi redaktəsinə mane olmur. Hər yeni dəyişiklik yenidən tətbiq siyahısını təmizləyir; tarixçə cari sessiya üçün son 30 əməliyyatı saxlayır.

İcraçı, fiqurun adı və növü, keçidin başlanğıcı, hədəfi və qolların sayı eyni layihə məlumatını dəyişir. Canlı izah cədvəli və sonrakı Word/Visio ixracı həmin vəziyyətdən hazırlanır. Əl ilə yazılmış təsvirlər qorunur.

## İlk versiyada olanlar

- Pool və lane-lər; başlanğıc, son, aralıq, mesaj və vaxt hadisələri.
- Tapşırıq, istifadəçi/sistem tapşırığı, alt proses, XOR/OR/AND keçidləri, sənəd və qeyd elementləri.
- Eyni pool daxilində ardıcıl axın, pool-lar arasında mesaj axını, sənəd/qeyd üçün nöqtəli əlaqə.
- Struktura əsaslanan Azərbaycan dilində izah; əlaqəsiz addımlar, olmayan hədəflər, başlanğıc/son və qərar şərtləri barədə yoxlama.
- İstifadəçinin verdiyi “Müştəri müraciətləri” nümunəsi: operator, vizaçı, aidiyyəti şəxslər, icraçılar, imtina/düzəliş dövrü, paralel ünvanlanma və QNV statusları. İmzalama nümunədə Vizaçı lane-indədir; ayrıca rol əlavə edib dəyişmək olar.
- Visio-da ayrı-ayrı seçilib redaktə olunan fiqurlarla **.vsdx** ixracı və izah üçün redaktə olunan **.docx** Word cədvəli.
- Fiqurların sürüklənməsi, diaqramdan ad/növ/icraçı/təsvir redaktəsi, keçid yaratmaq və silmək, uzun keçid izahları və ortaq qol nömrələri.
- Hesabsız istifadə, brauzerdə avtomatik yadda saxlama, son 30 dəyişikliyi geri alma və yenidən tətbiq etmə və təsdiqli **Hər şeyi sil**.
- Dar ekranlarda formanın altında ayrıca sürüşdürülən diaqram; tam ekran rejimi ilə axına geniş baxış.

## Yadda saxlama

Layihə məlumatı serverə göndərilmir. Dəyişikliklər 300 ms fasilədən sonra `localStorage`-da `visioflow:v1:<id>` açarı ilə saxlanılır; səhifədən çıxanda və layihə dəyişəndə gözləyən yazma dərhal tamamlanır. URL-dəki `#<id>` həmin brauzerdə onu bərpa edir. Səhifəni yeniləyəndə, bağlayıb eyni ünvanı açanda və ya əvvəlki versiyada yaratdığın layihənin hash ünvanına keçəndə işinə davam edə bilərsən. Hash silindikdə yeni boş layihə yaranır.

Hash layihənin identifikatorudur; məlumatın özü brauzerdə qalır. Eyni link başqa cihazda və ya başqa sayt domenində məlumatı bərpa etmir. Brauzerin sayt məlumatları təmizlənəndə saxlanmış layihələr də silinir. İnterfeysdə JSON yükləmə və açma yoxdur.

Boş, dəyişdirilməmiş layihə brauzer yaddaşına yazılmır; əvvəlki boş layihə açarları açılışda səssizcə təmizlənir. Məzmunlu layihələr saxlanılır. Eyni mətn sahəsində 600 ms daxilində ardıcıl dəyişikliklər bir tarixçə girişinə birləşdirilir.

Yuxarıdakı **Saxlanılır…** statusu gözləyən yazmanı, **Saxlanılıb** isə uğurlu yazmanı və ya dəyişdirilməmiş boş formanı göstərir. Brauzer yerli yaddaşı bloklayarsa və ya yaddaş dolarsa **Yaddaş əlçatan deyil** göstərilir; cari dəyişikliklər açıq səhifədə qalır. Yeni diaqram və ya nümunə açmaq istəyəndə saxlanılmamış işin itirilməsinə qarşı təsdiq tələb olunur. Saxlanılmamış dəyişikliklər olduqda səhifədən çıxış üçün brauzer xəbərdarlığı da verilir.

**Layihə menyusu → Hər şeyi sil** təsdiqdən sonra yalnız bu alətin yerli layihə açarlarını silir. Yeni diaqram və ya nümunə açmaq əvvəlki saxlanmış layihəni öz hash ünvanında saxlayır. Silmə uğursuz olarsa hazırkı layihə açıq qalır.

## Lokal inkişaf

Node.js 24 və npm istifadə et. Node versiyası `.nvmrc` və `package.json`-da göstərilib.

```sh
npm ci
npm run dev
```

Standart port 3000-dır.

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm start
```

Unit testlər proses qaydalarını, dövrlərin yerləşməsini, saxlanmış layihənin strukturunu və VSDX ZIP/XML paketini yoxlayır. Brauzer testləri forma redaktəsi, dərhal bərpa, hash sıfırlama, yaddaş nasazlığı, təsdiqli silmə, Visio ixracı və mobil diaqram idarəsini yoxlayır. E2E testi `CHROMIUM_PATH` verilərsə onu, yoxdursa `/usr/bin/chromium` mövcud olduqda sistem Chromium-unu istifadə edir. Digər maşında `npx playwright install chromium` ilə brauzeri quraşdır.

`.github/workflows/ci.yml` hər `main` push-u və pull request üçün Node 24 ilə `npm ci`, ESLint, typecheck, unit testlər və build işlədir. Tam production brauzer sınağı üçün əvvəl `npm run build` və `npm start`, ayrı terminalda isə `VISIOFLOW_PRODUCTION_TESTS=1 npm run test:e2e` işlədirik; bu rejim `/designs` səhifəsinin gizlədilməsini də yoxlayır.

Word sənədi ayrıca Office Open XML paketidir; həqiqi cədvəl, təkrarlanan başlıq və Azərbaycan hərfləri saxlanılır. Əlavə paket tələb olunmur. Word/VSDX struktur testlərindən başqa sürüklənən mövqelərin bərpası, native Visio koordinatları, bağlı oxlar və qol nömrələri də yoxlanılır.

## Sərbəst diaqram redaktəsi

Pool-un başlığını sürükləyəndə onun zolaqları və fiqurları birlikdə hərəkət edir; oxların ucları bağlı qalır. Yerləşmə avtomatik saxlanılır, yenidən açılışda bərpa olunur və Word/Visio/SVG/PNG ixracı ilə uyğun qalır. Geri al və yenidən tətbiq əməliyyatları pool hərəkətini də dəstəkləyir.

Palitradan fiquru pool-lar arasındakı boş sahəyə buraxmaq və ya mövcud fiquru ora sürükləmək olar. Belə fiqur **Pool-dan kənar** olur; icraçı seçicisindən bunu əl ilə seçmək və sonradan istənilən zolağa bağlamaq mümkündür. Sərbəst fiquru oxa buraxmaq həmin keçidin arasına addım əlavə edir və əvvəlki şərt/izahı qoruyur. Redaktə panelində **Fiqurun mövqeyi → X/Y** sahələri dəqiq yerləşdirmə üçündür; Enter və ya sahədən çıxış dəyişikliyi saxlayır.

**Qeyd** fonu olmayan nazik sol mötərizə və mavi mətnlə göstərilir. Qeydin mətnində hər məlumatı yeni sətirdə yazmaq, `•`, `-` və ya `*` ilə siyahı yaratmaq olar. Uzun sətirlər bükülür, siyahı girintisi qorunur; qeyd tapşırıq kartı kimi nömrələnmir. Ölçü tutacağından qeydi böyütmək mümkündür. Visio ixracında mətn və mötərizə redaktə oluna bilir.

## İnterfeys nümunələri

Ana səhifədə D iş masası yerləşməsi işləyir: başlıq, sol forma və sağdakı diaqram qaranlıqdır. Sahələr, fokus, seçim, xəta və uğur rəngləri hər fon üçün ayrıca seçilib. [Əvvəlki rəng variantının görünüşü](public/design-previews/design-d.png).

Lokal inkişaf rejimində `/designs` səhifəsində üç qaranlıq interfeys variantına baxmaq olar: **A — Addım-addım forma**, **B — Diaqram mərkəzdə**, **C — Cədvəldən diaqrama**. Production-da bu səhifə 404 qaytarır və menyuda göstərilmir. Nümunələr görünüşü müqayisə etmək üçündür; səhifə mövcud layihəni dəyişmir. İşlək redaktor ana səhifədədir.

Redaktə davranışı üçün yoxlanmış rəsmi açıq mənbə nümunələri: [draw.io mətn redaktəsi](https://github.com/jgraph/drawio/blob/dev/src/main/webapp/js/grapheditor/Graph.js), [bpmn-js iki kliklə redaktə](https://github.com/bpmn-io/bpmn-js/blob/develop/lib/features/label-editing/LabelEditingProvider.js), [diagram-js fiqur hərəkəti](https://github.com/bpmn-io/diagram-js/blob/develop/lib/features/move/Move.js), [Excalidraw imkanları](https://github.com/excalidraw/excalidraw#features).

## Vercel

1. [Vercel](https://vercel.com/new)-də GitHub hesabınla giriş et. Dashboard-dan **Add New → Project** seç.
2. **Import Git Repository** siyahısında `Sanan2030/Visio_generator` tap və **Import** düyməsini bas.
3. Repository görünmürsə **Configure GitHub App** vasitəsilə Vercel-ə bu repository üçün giriş ver, sonra siyahını yenilə. Repository private qala bilər.
4. Project Name üçün məsələn `visio-generator` yaz. Root Directory-ni repository kökü olaraq saxla (`./`). Layihə alt qovluqda deyil.
5. Aşağıdakı parametrləri yoxla. `vercel.json` framework, install və build əmrlərini, `package.json` isə Node versiyasını göstərir.

| Parametr | Dəyər |
| --- | --- |
| Framework Preset | **Next.js** |
| Root Directory | `./` — repository kökü |
| Node.js Version | **24.x** |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | Next.js standartı; override əlavə etmə |
| Environment Variables | Bu versiya üçün əlavə etməyə ehtiyac yoxdur |

6. **Deploy** düyməsini bas. Build tamamlanıb **Ready** olduqda Vercel-in verdiyi `.vercel.app` ünvanını aç.
7. Layihənin **Settings → Git** bölməsində **Production Branch** dəyərinin `main` olduğunu yoxla. Sonrakı `main` push-ları avtomatik yeni production deploy yaradacaq.
8. Saytda proses adına basıb **Nümunə proses** aç, **Addımlar** bölməsində bir formanı dəyiş, səhifəni yenilə və yaddaşın bərpasını yoxla. **Visio üçün yüklə** ilə `.vsdx`, **Word izahı** ilə `.docx` faylını yüklə.

Bu versiya hesab, verilənlər bazası və AI açarı tələb etmir. Deploy uğursuz olarsa **Deployment → Build Logs** bölməsini aç: Node versiyası `24.x`, repository kökü isə `./` olmalıdır.

Rəsmi sənədlər: [GitHub inteqrasiyası](https://vercel.com/docs/git/vercel-for-github), [build parametrləri](https://vercel.com/docs/deployments/configure-a-build).

## Məhdudiyyətlər və sonrakı iş

Bu, əsas BPMN elementləri ilə diaqram redaktorudur; biznes prosesini icra edən mühərrik və tam BPMN standart validatoru deyil. Alt proses vahid fiqur kimi göstərilir, iç-içə ayrıca səhifə redaktoru hələ yoxdur. Pool/lane-lər VSDX-də redaktə olunan fiqurlardır, Visio-nun xüsusi container/master-ləri deyil; pool-u hərəkət etdirmək daxilindəki elementləri birlikdə daşımır.

VSDX native fiqurlar, Unicode mətn və əlaqəli birləşdiricilərdən ibarətdir. Oxların Shape Data hissəsində başlanğıc/hədəf identifikatorları, etiket, tam izah və qol nömrəsi saxlanılır. ZIP/XML struktur testləri və LibreOffice import/conversion yoxlaması var. Microsoft Visio Desktop/Web-də açmaq, fiquru dəyişmək və birləşdiricini yoxlamaq ayrıca əl ilə qəbul sınağı tələb edir.

**Sloth AI hazırda qoşulmayıb.** İstifadə yeri və API müqaviləsi dəqiqləşəndən sonra inteqrasiya ayrıca əlavə edilə bilər. Hazırkı izah xarici AI çağırışı etmədən, formaya daxil edilən məlumatlardan qaydalar əsasında hazırlanır.

Bir layihədə maksimum 8 pool, hər pool üçün 20 lane və ümumi 200 element mümkündür. Natamam addımlar da avtomatik saxlanılır; Visio faylını yükləmək üçün struktur xətaları düzəldilməlidir. Yeni yazmalar üçün layihə həddi 2 MB UTF-8-dir; bu, adətən 5 MiB olan localStorage tutumu üçün ehtiyatlı həddir. Saytda qalan ümumi yer ayrıca yoxlanılır və yaddaş dolarsa aydın bildiriş göstərilir. Əvvəlki böyük layihələr açılır, amma həddi aşan yeni yazma mövcud saxlanmış nüsxəni əvəz etmir. Fiquru lane-lər və pool-lar arasında sürükləmək, həmçinin redaktə panelində icraçısını seçmək mümkündür. Pool-lar arasında keçid yaradıldıqda mesaj axını avtomatik göstərilir. Pool və diaqram ölçüləri məzmuna görə avtomatik hesablanır və əl ilə dəyişdirilə bilər. Pool-ları başlığından sürükləyərək daxilindəki fiqurlarla birlikdə hərəkət etdirmək olar. Başlıq fokusda olduqda ox düymələri 10, Shift + ox isə 50 piksel dəyişir; Escape sürükləməni ləğv edir. Fiqurların ölçüsü də dəyişdirilir; hadisə və gateway formaları kvadrat nisbəti qoruyur.
