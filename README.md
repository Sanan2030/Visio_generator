# VisioFlow

Azərbaycan dilində, formaya daxil edilən iş axınını canlı diaqrama çevirən veb alət. Seçilmiş **D — İşıqlı iş masası** dizaynında ağ forma solda, nöqtəli diaqram sahəsi sağda yerləşir. Next.js və React ilə hazırlanıb; Vercel-də yerləşdirilə bilər.

## İş ardıcıllığı

1. **İştirakçılar** formasında prosesin adını və pool sayını daxil et. Hər pool iştirakçı təşkilatı/tərəfi, daxilindəki lane-lər isə icraçı rollarını göstərir.
2. **Addımlar** bölməsində başlanğıc, tapşırıqlar və son hadisəsi əlavə et. Hər addımın kartını açaraq adını, element növünü, icraçısını və istəyə bağlı iş təsvirini doldur. Bir anda bir addımın forması açıq olur.
3. Addım kartındakı yığcam keçid sətrinə və ya diaqramdakı kiçik etiketə basaraq hədəfi, qısa mətni və ətraflı izahı redaktə et. XOR bir yol, OR bir və ya bir neçə uyğun yol, AND isə bütün paralel yollar üçündür; qərar kartındakı üç düymə ilə növü dəyişmək olar. Bir addımdan bir neçə qol çıxanda onların nömrələri `4.1`, `4.2` kimi göstərilir.
4. Sağdakı diaqramda fiquru öz lane-i daxilində sürüklə. Oxlar ona bağlı qalır; yerləşmə hash ünvanındakı layihə ilə birlikdə saxlanılır və Visio ixracında qorunur. Fiqura iki dəfə kliklə kompakt redaktə panelini aç. Seçilmiş fiqurun **+** tutacağını başqa fiqura apararaq keçid yarat; tutacağa və sonra hədəfə klikləmək də mümkündür.
5. **İzah** bölməsində üçsütunlu cədvələ bax və **Word cədvəli yüklə** ilə redaktə olunan `.docx` sənədini əldə et. Sütunlar **Addımın sıra N-si**, **İcraçı**, **Addımların təsviri** şəklindədir; qol nömrələri diaqramdakılarla eynidir. **Visio üçün yüklə** isə redaktə olunan `.vsdx` faylı yaradır.

Diaqramın aşağısındakı alət panelində **Seç**, **Sahəni sürüşdür**, başlanğıc, tapşırıq, qərar, keçid, qeyd və redaktə düymələri var. Sahəni sürüşdür aləti seçiləndə fiqurun üzərindən sürükləmək də yalnız görünüşü hərəkət etdirir. **Keçid çək** seçilmiş addımı növbəti kliklənən fiqura bağlayır. Digər element növlərini forma və ya redaktə panelində seçmək olar.

Fokus fiqurda olduqda ox düymələri onu 1 vahid, Shift + ox isə 10 vahid hərəkət etdirir; F2 redaktə panelini açır, Delete fiquru silir. Sürüşdürmə zamanı Esc hərəkəti ləğv edir. Fokus diaqram sahəsində olduqda oxlar sahəni sürüşdürür. Aşağı sağdakı **Avtomatik düz** əl ilə yerləşdirməni sıfırlayır; **Geri al** ilə bərpa etmək olar. Böyütmə, ekrana sığdırma və tam ekran rejimində redaktə də mümkündür. Yuxarıdakı proses adına basmaq **Yeni diaqram**, **Nümunə proses**, kömək və silmə menyusunu açır; **Word izahı** birbaşa `.docx` cədvəlini yükləyir.

## İlk versiyada olanlar

- Pool və lane-lər; başlanğıc, son, aralıq, mesaj və vaxt hadisələri.
- Tapşırıq, istifadəçi/sistem tapşırığı, alt proses, XOR/OR/AND keçidləri, sənəd və qeyd elementləri.
- Eyni pool daxilində ardıcıl axın, pool-lar arasında mesaj axını, sənəd/qeyd üçün nöqtəli əlaqə.
- Struktura əsaslanan Azərbaycan dilində izah; əlaqəsiz addımlar, olmayan hədəflər, başlanğıc/son və qərar şərtləri barədə yoxlama.
- İstifadəçinin verdiyi “Müştəri müraciətləri” nümunəsi: operator, vizaçı, aidiyyəti şəxslər, icraçılar, imtina/düzəliş dövrü, paralel ünvanlanma və QNV statusları. İmzalama nümunədə Vizaçı lane-indədir; ayrıca rol əlavə edib dəyişmək olar.
- Visio-da ayrı-ayrı seçilib redaktə olunan fiqurlarla **.vsdx** ixracı və izah üçün redaktə olunan **.docx** Word cədvəli.
- Fiqurların sürüklənməsi, diaqramdan ad/növ/icraçı/təsvir redaktəsi, keçid yaratmaq və silmək, uzun keçid izahları və ortaq qol nömrələri.
- Hesabsız istifadə, brauzerdə dərhal avtomatik yadda saxlama, son 30 dəyişikliyi geri alma və təsdiqli **Hər şeyi sil**.
- Dar ekranlarda formanın altında ayrıca sürüşdürülən diaqram; tam ekran rejimi ilə axına geniş baxış.

## Yadda saxlama

Layihə məlumatı serverə göndərilmir. Hər dəyişiklik həmin anda `localStorage`-da `visioflow:v1:<id>` açarı ilə saxlanılır; URL-dəki `#<id>` həmin brauzerdə onu bərpa edir. Səhifəni yeniləyəndə, bağlayıb eyni ünvanı açanda və ya əvvəlki versiyada yaratdığın layihənin hash ünvanına keçəndə işinə davam edə bilərsən. Hash silindikdə yeni boş layihə yaranır.

Hash layihənin identifikatorudur; məlumatın özü brauzerdə qalır. Eyni link başqa cihazda və ya başqa sayt domenində məlumatı bərpa etmir. Brauzerin sayt məlumatları təmizlənəndə saxlanmış layihələr də silinir. İnterfeysdə JSON yükləmə və açma yoxdur.

Yuxarıdakı **Saxlanılıb** statusu uğurlu yadda saxlama deməkdir. Brauzer yerli yaddaşı bloklayarsa və ya yaddaş dolarsa **Yaddaş əlçatan deyil** göstərilir; cari dəyişikliklər açıq səhifədə qalır. Yeni diaqram və ya nümunə açmaq istəyəndə saxlanılmamış işin itirilməsinə qarşı təsdiq tələb olunur. Saxlanılmamış dəyişikliklər olduqda səhifədən çıxış üçün brauzer xəbərdarlığı da verilir.

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
npm test
npm run test:e2e
npm run build
npm start
```

Unit testlər proses qaydalarını, dövrlərin yerləşməsini, saxlanmış layihənin strukturunu və VSDX ZIP/XML paketini yoxlayır. Brauzer testləri forma redaktəsi, dərhal bərpa, hash sıfırlama, yaddaş nasazlığı, təsdiqli silmə, Visio ixracı və mobil diaqram idarəsini yoxlayır. E2E testi `CHROMIUM_PATH` verilərsə onu, yoxdursa `/usr/bin/chromium` mövcud olduqda sistem Chromium-unu istifadə edir. Digər maşında `npx playwright install chromium` ilə brauzeri quraşdır.

Word sənədi ayrıca Office Open XML paketidir; həqiqi cədvəl, təkrarlanan başlıq və Azərbaycan hərfləri saxlanılır. Əlavə paket tələb olunmur. Word/VSDX struktur testlərindən başqa sürüklənən mövqelərin bərpası, native Visio koordinatları, bağlı oxlar və qol nömrələri də yoxlanılır.

## İnterfeys nümunələri

Ana səhifədə **D — İşıqlı iş masası** dizaynı işləyir. [Yeni interfeysin görünüşü](public/design-previews/design-d.png).

`/designs` səhifəsində üç qaranlıq interfeys variantına baxmaq olar: **A — Addım-addım forma**, **B — Diaqram mərkəzdə**, **C — Cədvəldən diaqrama**. Bunlar görünüşü müqayisə etmək üçündür; səhifə mövcud layihəni dəyişmir. İşlək redaktor ana səhifədədir. Nümunələrdə fiqur və kiçik keçid etiketini seçərək panel görünüşünü də müqayisə etmək olar.

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

VSDX native fiqurlar, Unicode mətn və əlaqəli birləşdiricilərdən ibarətdir. ZIP/XML struktur testləri və LibreOffice import/conversion yoxlaması var. Microsoft Visio Desktop/Web-də açmaq, fiquru dəyişmək və birləşdiricini yoxlamaq ayrıca əl ilə qəbul sınağı tələb edir.

**Sloth AI hazırda qoşulmayıb.** İstifadə yeri və API müqaviləsi dəqiqləşəndən sonra inteqrasiya ayrıca əlavə edilə bilər. Hazırkı izah xarici AI çağırışı etmədən, formaya daxil edilən məlumatlardan qaydalar əsasında hazırlanır.

Bir layihədə maksimum 8 pool, hər pool üçün 20 lane və ümumi 200 element mümkündür. Natamam addımlar da avtomatik saxlanılır; Visio faylını yükləmək üçün struktur xətaları düzəldilməlidir. Brauzerin yerli yaddaş tutumu ayrıca məhdudiyyət yaradır. Fiqur öz lane-i daxilində sürüklənir; başqa lane-ə keçirmək üçün redaktə panelində icraçını dəyiş. Pool/lane ölçüləri avtomatik hesablanır, onların sərbəst sürüklənməsi və fiqurların ölçüsünü əl ilə dəyişmək bu versiyaya daxil deyil.
