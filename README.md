# VisioFlow

Azərbaycan dilində, formaya daxil edilən iş axınını canlı diaqrama çevirən veb alət. Qaranlıq iş məkanında forma solda, bütün axının görünüşü sağda yerləşir. Next.js və React ilə hazırlanıb; Vercel-də yerləşdirilə bilər.

## İş ardıcıllığı

1. **İştirakçılar** formasında prosesin adını və pool sayını daxil et. Hər pool iştirakçı təşkilatı/tərəfi, daxilindəki lane-lər isə icraçı rollarını göstərir.
2. **Addımlar** bölməsində başlanğıc, tapşırıqlar və son hadisəsi əlavə et. Hər addımın kartını açaraq adını, element növünü, icraçısını və istəyə bağlı iş təsvirini doldur. Bir anda bir addımın forması açıq olur.
3. Addımın hədəfini və keçid şərtini seç. XOR bir yol, OR bir və ya bir neçə uyğun yol, AND isə bütün paralel yollar üçündür. Əvvəlki addımlara qayıtmaq və bir neçə qol yaratmaq mümkündür.
4. Sağdakı canlı diaqram dəyişiklikləri dərhal göstərir və ilkin olaraq bütün axını ekrana sığdırır. Elementə kliklə və ya klaviatura ilə seçərək onun formasını aç. Böyütmə, kiçiltmə, sürüşdürmə və tam ekran rejimi var.
5. **İzah** bölməsində əlaqələri yoxla. **Visio üçün yüklə** düyməsi redaktə olunan `.vsdx` faylı yaradır. İzahı ayrıca **Mətn yüklə** ilə əldə etmək olar.

## İlk versiyada olanlar

- Pool və lane-lər; başlanğıc, son, aralıq, mesaj və vaxt hadisələri.
- Tapşırıq, istifadəçi/sistem tapşırığı, alt proses, XOR/OR/AND keçidləri, sənəd və qeyd elementləri.
- Eyni pool daxilində ardıcıl axın, pool-lar arasında mesaj axını, sənəd/qeyd üçün nöqtəli əlaqə.
- Struktura əsaslanan Azərbaycan dilində izah; əlaqəsiz addımlar, olmayan hədəflər, başlanğıc/son və qərar şərtləri barədə yoxlama.
- İstifadəçinin verdiyi “Müştəri müraciətləri” nümunəsi: operator, vizaçı, aidiyyəti şəxslər, icraçılar, imtina/düzəliş dövrü, paralel ünvanlanma və QNV statusları. İmzalama nümunədə Vizaçı lane-indədir; ayrıca rol əlavə edib dəyişmək olar.
- Visio-da ayrı-ayrı seçilib redaktə olunan fiqurlarla **.vsdx** ixracı və izah üçün **.txt** yükləmə.
- Hesabsız istifadə, brauzerdə dərhal avtomatik yadda saxlama, son 30 dəyişikliyi geri alma və təsdiqli **Hər şeyi sil**.
- Dar ekranlarda formanın altında ayrıca sürüşdürülən diaqram; tam ekran rejimi ilə axına geniş baxış.

## Yadda saxlama

Layihə məlumatı serverə göndərilmir. Hər dəyişiklik həmin anda `localStorage`-da `visioflow:v1:<id>` açarı ilə saxlanılır; URL-dəki `#<id>` həmin brauzerdə onu bərpa edir. Səhifəni yeniləyəndə, bağlayıb eyni ünvanı açanda və ya əvvəlki versiyada yaratdığın layihənin hash ünvanına keçəndə işinə davam edə bilərsən. Hash silindikdə yeni boş layihə yaranır.

Hash layihənin identifikatorudur; məlumatın özü brauzerdə qalır. Eyni link başqa cihazda və ya başqa sayt domenində məlumatı bərpa etmir. Brauzerin sayt məlumatları təmizlənəndə saxlanmış layihələr də silinir. İnterfeysdə JSON yükləmə və açma yoxdur.

Yuxarıdakı **Saxlanıldı** statusu uğurlu yadda saxlama deməkdir. Brauzer yerli yaddaşı bloklayarsa və ya yaddaş dolarsa **Yaddaş əlçatan deyil** göstərilir; cari dəyişikliklər açıq səhifədə qalır. Yeni diaqram və ya nümunə açmaq istəyəndə saxlanılmamış işin itirilməsinə qarşı təsdiq tələb olunur. Saxlanılmamış dəyişikliklər olduqda səhifədən çıxış üçün brauzer xəbərdarlığı da verilir.

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
8. Saytda **Nümunə** aç, **Addımlar** bölməsində bir formanı dəyiş, səhifəni yenilə və yaddaşın bərpasını yoxla. **Visio üçün yüklə** ilə `.vsdx` faylını yüklə.

Bu versiya hesab, verilənlər bazası və AI açarı tələb etmir. Deploy uğursuz olarsa **Deployment → Build Logs** bölməsini aç: Node versiyası `24.x`, repository kökü isə `./` olmalıdır.

Rəsmi sənədlər: [GitHub inteqrasiyası](https://vercel.com/docs/git/vercel-for-github), [build parametrləri](https://vercel.com/docs/deployments/configure-a-build).

## Məhdudiyyətlər və sonrakı iş

Bu, əsas BPMN elementləri ilə diaqram redaktorudur; biznes prosesini icra edən mühərrik və tam BPMN standart validatoru deyil. Alt proses vahid fiqur kimi göstərilir, iç-içə ayrıca səhifə redaktoru hələ yoxdur. Pool/lane-lər VSDX-də redaktə olunan fiqurlardır, Visio-nun xüsusi container/master-ləri deyil; pool-u hərəkət etdirmək daxilindəki elementləri birlikdə daşımır.

VSDX native fiqurlar, Unicode mətn və əlaqəli birləşdiricilərdən ibarətdir. ZIP/XML struktur testləri və LibreOffice import/conversion yoxlaması var. Microsoft Visio Desktop/Web-də açmaq, fiquru dəyişmək və birləşdiricini yoxlamaq ayrıca əl ilə qəbul sınağı tələb edir.

**Sloth AI hazırda qoşulmayıb.** İstifadə yeri və API müqaviləsi dəqiqləşəndən sonra inteqrasiya ayrıca əlavə edilə bilər. Hazırkı izah xarici AI çağırışı etmədən, formaya daxil edilən məlumatlardan qaydalar əsasında hazırlanır.

Bir layihədə maksimum 8 pool, hər pool üçün 20 lane və ümumi 200 element mümkündür. Natamam addımlar da avtomatik saxlanılır; Visio faylını yükləmək üçün struktur xətaları düzəldilməlidir. Brauzerin yerli yaddaş tutumu ayrıca məhdudiyyət yaradır. Elementləri tətbiqdə sürükləyərək yerini dəyişmək funksiyası yoxdur; yerləşmə avtomatik hesablanır, əl ilə düzəlişləri Visio-da etmək olar.
